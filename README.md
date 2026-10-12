> **v7.11 upgrade:** Builders only rename. Every manager gets its own builder, which starts as soon as that manager's workers finish and links only the imports that cross between its children; the parent receives the child's linked bundle. Edits are limited to import paths and identifier names, checked token by token with Acorn. Root's builder alone picks the entry and starts the Container, and a separate runner writes a test from the Root goal and the live API that `start()` returns. Anything renaming cannot fix goes back to the worker that owns it. Workers may import collaborators by the path and name they expect, and every worker file must parse before it is committed. Every agent pushes at most one Artifacts commit per turn, and builders resolve mechanical imports without a model call. **184/184 local tests passed; live Cloudflare not verified.** See `CHANGELOG-v7.11.md`. Licensed MIT (`LICENSE`).

> **v7.10 — Join-only builder recovery:** Empty Qwen builder actions can no longer suppress targeted generation of `glue/wiring.js` and `glue/smoke.js`. The runtime still owns the loader and package, leaves own original implementations, and Container failures route a specific joint for repair. **185 local tests pass; no live Cloudflare verification.** See `CHANGELOG-v7.10.md`.

> **v7.9 — Behavioral acceptance:** The deterministic entrypoint is unchanged. Root builders now author `glue/wiring.js` **and** `glue/smoke.js`. The Container executes the builder-authored test through the assembled app and rejects wiring with disconnected stores. Smoke failures return to the builder; passing Node imports alone no longer finish the application. **182 local tests pass.** See `CHANGELOG-v7.9.md`.

> **v7.8 — Permanent runtime linker:** The runtime now commits exact-path `glue/index.js` and `package.json` on every builder materialization; Qwen writes **only** `glue/wiring.js`, accepting loaded component namespaces and connecting collaborators. A baseline can still run when wiring fails but is never treated as an integrated application. Builder wake generations are preserved during concurrent turns; Continue can requeue an idle final builder. New production leaves must publish native `.js`/`.mjs`/`.cjs`. Root catches `Application Orchestrator` and `Main Application` integration branches. **178 local tests pass; no live deployment verified.** See `CHANGELOG-v7.8.md`.

# v7.7 — Deterministic diagnostic linker

The Cloudflare runtime can now derive `glue/index.js` and `package.json` **without inference** from `assembly.manifest.json`. When Qwen invents an import, produces invalid glue, or fails to finish an acceptable assembly, a baseline diagnostic Container build can still run. It loads the actual `.js`/`.mjs`/`.cjs` modules at their materialized destinations and reports real failures to the owner of the source. This diagnostic is **never** mistaken for an integrated application or an accepted builder result. TypeScript/JSX inputs are excluded from the bare-Node baseline and require compiler-aware integration. See [CHANGELOG-v7.7.md](CHANGELOG-v7.7.md).

This version also includes the in-progress v7.6 builder replan and refreshed source-snapshot changes. **174/174 local tests pass; live deployment unverified.**

---

# v7.5 — Recover from invalid code splits

Clef can reverse a split decision after seeing Qwen's rejected partition. Qwen receives actionable rejection details for any corrected split, and a leaf continues only if Clef routes its local assigned code to implementation. No automatic whole-assignment fallback. See `CHANGELOG-v7.5.md`. **167/167 local tests passed; live Cloudflare build remains unverified.**

---

# v7.4 — Builder diagnostics and live assembly routing

See `CHANGELOG-v7.4.md` for three fixes to production builder rejection, failure reporting, and Root split filtering. The latest suite passes 165/165 tests; remote Cloudflare behavior remains unverified.

---

> **v7.3 — Independent leaf dependencies:** Leaf Qwen authors code using Node built-ins or browser-native APIs, never invented sibling import paths or npm packages. A source publication gate requires relative imports to resolve only to files authored by the same leaf; builders connect external collaborators. Mock output no longer declares Express. See `CHANGELOG-v7.3.md`.

# Recursive code-writing control plane — v7.2

**Current behavior (v7.2):** Code-writing work recursively splits into smaller code-writing work. Clef routes and gates split proposals against the original goal and assigned code; Qwen proposes however many independent code modules are needed within the room's configured capacity; Qwen leaves implement real source. Managers are routers, not assemblers. Only on-demand builders assemble preserved worker source, beginning provisionally if useful, then finalizing at the completed source boundary or when an actual diagnostic requires repair. There is **no forced 2–3 fanout, no forced whole-assignment fallback, no builder inference on each source revision, and no two-file/four-file or 5KB glue quota**. Existing explicit task constraints are respected; splitter-created file and export names are not. See [CHANGELOG-v7.2.md](CHANGELOG-v7.2.md).

**Historical sections below describe earlier releases and may contain superseded decisions and test counts. Treat the v7.2 changelog and source as authoritative for current behavior.**

**Every delegated production task requests code.** Clef routes the decision, Qwen splits code into smaller code assignments, Qwen leaves write the source, and the temporary builder alone integrates source files. A parent that has delegated stays a router; it never assembles its children.

See [CHANGELOG-v7.1.md](CHANGELOG-v7.1.md) for the v7.1 filename/interface correction, and [CHANGELOG-v7.0.md](CHANGELOG-v7.0.md) for the earlier code-first routing changes.

**v7.1 correction:** the Qwen splitter asks for smaller pieces of code, but does not name files or dictate exported signatures. A leaf chooses its own file and API unless the delegated task already contains an explicit requirement. The builder still assembles the published implementations.

> v6.8 adds npm dependency-installation caching and diagnostic classification; see `CHANGELOG-v6.8.md`.

# Recursive Control Plane v6.6 — Faster Builders + Container Retry Recovery

## v6.6 — Builder-loop fixes

The v6.5 issue-tracker run reported `Invalid build fingerprint` because its full JSON source revision inventory was longer than the BuildExecutor's 240-character input ceiling. v6.6 sends SHA-256 of the inventory to the BuildExecutor and separately verifies the immutable source digest; the original inventory remains in the room for freshness and completion checks.

After Container infrastructure errors, an unchanged builder now waits instead of being woken by quiescent-nudge or another inference pass. Press **Continue** to retry the existing packaged application deterministically, without another Qwen turn. Older v6.5 rooms with a persisted infrastructure error can also retry their existing Root builder. Builder output exceeding the 5,000-character cap is now handled within the three-attempt bounded correction loop, and repeated byte-for-byte glue is not recommitted. Builder generation has a lower default maximum of 1,600 output tokens.

See **[INSTALL-CLOUDFLARE.md](INSTALL-CLOUDFLARE.md)** for accurate upgrade and install instructions; the historical v6.4 install section near the end of this README belongs to v6.4, not this release.

---

A Cloudflare-only recursive programming experiment. The control plane, inference, Git storage, and **isolated application build execution** all stay on Cloudflare:

- **Workers + Durable Objects (SQLite)**: one room coordinator plus one separate SQLite-backed Durable Object per manager (Root included); persistent actions, a continuously replenished worker scheduler, and all-or-nothing child delegation.
- **Workers AI · Clef-flash** (`@cf/cloudflare/clef-flash`): handles typed `noul` YES/NO classification for splitting and (after Qwen proposes child behaviors) per-child scope admission. Clef provides probabilities. No generated JSON or chain-of-thought to parse. Alternate `@cf/cloudflare/clef` is selectable in the GUI.
- **Workers AI · Qwen3 30B-A3B** (`@cf/qwen/qwen3-30b-a3b-fp8`): generates a *quick guess* of two or three child behaviors when Clef says YES, and generates leaf code. This Mixture-of-Experts model has **about 3B active parameters per token**, though it has 30B total parameters; it is not a 3B-sized downloaded model. It is the default generative agent.
- **Optional tiny 1B implementer** (`@cf/meta/llama-3.2-1b-instruct`): selectable in the GUI for a deliberately challenging small-model test. Expect poorer JSON, coding, and interface reliability than Qwen. The original Qwen 3.8 27B remains selectable for comparison.
- **Cloudflare Artifacts**: one real remote Git repository per agent, containing code for leaves and memory/ownership/export aliases for managers.
- **Cloudflare Containers**: a dedicated `BuildExecutor` Durable Object invokes a Node Linux container to compile and execute checks on an immutable Root assembly snapshot. This is a deterministic build worker, not another AI agent.

**No Ollama, local server, tunnel, external inference provider, or local SQLite.** The Worker name remains `qwen-control-plane-v4`, so `npm run deploy` updates the existing control-plane Worker. Deploying the new Container image requires local Docker and an account with Cloudflare Containers enabled. Local Node tests do not prove Cloudflare deployment.

## v6.5 — Build the app, inspect the result, route repairs to the owner

**No application completion without a successful execution report.** A Root assembly that passes the v6.4 static linker gate now submits the **entire actual source bundle** to `BUILD_EXECUTORS`, a per-room/per-experiment `BuildExecutor` Durable Object with a Cloudflare Container. A Root that Clef classified as an indivisible implementer is also build-gated; it cannot claim completion solely from `done:true`.

**Pinned snapshot:** The room collects actual source bytes and hashes a lexicographically ordered `(path, content)` list with SHA-256. The Container receives those files as an immutable JSON payload over stdin, independently computes and checks that hash, creates a fresh per-run directory, runs bounded commands, and deletes the directory afterward. Cloudflare's `ctx.container.exec()` executes `node /opt/build-runner.mjs`. A certificate from a different fingerprint or source digest is rejected; modifying a Root builder's glue invalidates its previous certificate. The `BuildExecutor` itself reports `passed` or `failed`; no Qwen field can force a success.

**Actual build process:** The runner uses `node --check` for ordinary Node modules, installs declared npm dependencies (`npm install --ignore-scripts`, capped at 55 s), runs `npm run build` when available (up to 50 s), `npm run test` when present (40 s), and `npm run smoke` when present (20 s). When there are no build/test/smoke scripts, it tries `npm run start` with a bounded 10-second stdin smoke probe. Static HTML without scripts gets a static asset check. For frontend projects with a `build` script, the bundler—not raw `node --check`—must parse JSX or other transformed syntax. The overall container command is capped at 120 s. Exit codes, bounded stdout/stderr, source file diagnostics, compiled output hashes and a small text preview return to the room's **Build evidence** dashboard section and JSON export. Real outputs are not yet retained as downloadable build archives.

**Root repair dispatcher:** On a failed build, Root reads the build report and resolves source paths through the `builder_sources` lineage, including intermediate delegated sub-builders. It sends an opaque repair ticket **one direct-manager hop at a time** to the leaf worker that originally owns the code. The worker gets the precise failure in its next Qwen turn and may update **its own** source. Failures without resolvable worker provenance are routed to the Root linker, which can only change small glue/configuration. No manager rewrites implementation files; no new AI review agent is created. Rebuilt revisions generate new hashes, invalidating stale certificates. After eight failed routed candidates, Root fails visibly instead of looping forever; the atomic Root path has a bounded retry limit too.

**Failure handling:** Cloudflare Container provisioning, timeouts, unpinned results, and other infrastructure errors are **not** reported as code failures and do not trigger blind inference fixes. They block completion and surface as `build_infrastructure` in state/events. A Qwen builder never commits its final completion merely because the static gate passed.

**Trust boundary:** This is real executable verification, not a mathematical proof of business correctness. It runs tests supplied in the generated app; absent or weak tests cannot establish that the issue tracker actually supports all CRUD behavior. It does not currently open a browser, inspect a screenshot, retain binary build outputs, or authenticate external services. Only text files can be submitted, up to 1,600 files / 4 MiB. The container is an ephemeral isolated environment with outbound Internet enabled for npm dependency fetching, **without application secrets**. Run only on a trusted Cloudflare account and review executable third-party dependencies accordingly. These build tests are demonstrated locally in Node, but **the actual Cloudflare Container deployment and remote execution are not yet verified**.

**Local verification:** 129 Node tests pass, including real `node --check` and npm execution, compiled output inventory, container RPC stdin protocol, build failure vs success, Root manager-hop repair routing, nested provenance through delegated builders, stale glue certificate invalidation, atomic Root blocking, and the existing multi-agent tests. The container RPC itself is simulated in tests; the build runner executes as a real local Node subprocess for command tests.

Deploy normally after installing dependencies and having Docker available:

```bash
npm install
npm test
npm run check
npm run deploy
```

---

## v6.4 — Builder output is untrusted until mechanically accepted

v6.3's Root builder published an **unterminated `glue/index.js`** with an invalid `require("./...")` path and declared itself done. v6.4 moves correctness gates into the **runtime write path and lifecycle**. A model's `done:true` is not evidence that a build succeeded.

**Artifact commit gate:** The builder may author only JS linker modules/entrypoints plus allowed package/HTML metadata; implementation is still exclusively worker-authored. Each proposed linker source is parsed with vendored **Acorn** (MIT license in `src/vendor/ACORN-LICENSE`) and local static imports, re-exports, dynamic literal imports and `require()` paths must resolve against the builder's actual materialized repository. An incomplete JS response or an import from `glue/` that mistakenly uses `./components/...` rather than `../components/...` is **rejected before the remote Artifacts push**. Valid code can be generated using the same source file request, with the exact rejection reason fed back to Qwen, for at most three bounded attempts per operation. Replayed pending actions go through the same gate.

**No false finality:** Before a builder revision is accepted, the runtime revalidates **every builder-owned linker file**, checks each expected copied input against the actual latest owner bytes, and (when production branches are complete) requires a Root application entrypoint: complete `index.html` or parseable `package.json` with a recognized launcher referencing an existing file. Invalid packages cannot advance `assembly_completed`, and a manager will not expose malformed provisional linker bundles. Any missing root package or code defect becomes a concrete `builder_repair_required` diagnostic for the *same builder*, which gets up to five revision-level repair passes before failing visibly. No extra AI review agent.

**No missed revisions:** The source fingerprint is captured **before** Qwen inference, not after; an arrival during inference cannot be marked incorporated by the older in-flight turn. An out-of-date or unverified builder stays runnable and receives the new revision. A manager is woken **after** the builder's `done` status commits, closing the prior completion-order race. Revision acceptance is pinned to actual code bytes, not just a builder status or name.

**What this guarantees:** Malformed or unresolved builder-generated JS is never committed through the v6.4 production builder write path, and a missing/invalid final launch package cannot be accepted as a finished assembly. These are deterministic, **fail-closed safety properties**, not claims that a generated app implements its business logic or runs successfully. The gate does not execute the application; JS glue is supported, while JSX/TypeScript glue is rejected pending an appropriate parser. External npm dependencies, dynamic non-literal imports, and worker code semantics still need execution/integration testing. There has been no live Cloudflare deployment of v6.4.

**Regression results:** 120 local Node tests passed, including the exact truncated-code failure, bad relative `require()`, zero Artifacts writes for malformed proposals, missing Root launch metadata, old/new source fingerprint mismatch, live source changes during builder inference, automatic second-pass repair, and module-format launcher mismatch. `npm run check` also passed.

---

## v6.3 — One builder until the source no longer fits

**Default: one Root builder.** Unlike v6.1/v6.2, a manager does *not* automatically create a sub-builder when its children publish code. The control plane collects **unique implementation files from producer leaves** across the existing ownership tree, with no transitive alias paths or repeated nested assembly manifests. The Root builder starts on provisional source even while other producers are still running. Its runtime materializes that source byte-for-byte, records SHA-256 provenance, and asks Qwen to write only small imports, adapters, exports, and entrypoint/config files. It may make additional integration passes as revised code arrives.

**Context decision:** No Clef call is required to decide whether context fits. A deterministic, deliberately conservative estimator uses three source characters per token, 100 tokens of per-file metadata, and a 2,200-token baseline for prompting and previous glue. With Qwen's nominal 32,768-token context, only **21,845 estimated tokens (two-thirds)** are allocated to code and builder context. The remaining third is reserved for responses and additional passes. This is a heuristic, **not an exact Qwen tokenizer count**; real Cloudflare token limits have not been benchmarked in this release.

**When over budget:** The current manager identifies the largest *eligible manager-owned implementation subtrees*, marks as many as necessary for delegated integration, and wakes those managers. Each delegated manager applies the *same* budget test to its subtree and can delegate deeper, creating more than one sub-builder only when necessary. The parent model consumes only each delegated builder's own public `glue/` and entrypoint/config files (not nested worker `index.js` source), while the runtime still copies **all underlying code bytes** into its package. A delegated branch can publish provisionally; changed source revisions wake existing builders rather than spawning replacements.

```text
Small source:    Workers in arbitrary-depth ownership tree → ONE Root builder → app
Large source:    Worker subtrees → builder(s) only for oversized branches → Root builder → app
```

**No semantic verification or new implementers.** Workers remain the sole authors of domain functionality; builders are linkers. A manager still cannot write source. Existing per-manager Durable Objects retain their routing and message state; the room still dispatches worker turns and holds the global export index. A single *atomic leaf* whose output by itself exceeds the context budget cannot currently be decomposed by the integration planner: the planner logs `builder_overflow` and waits instead of silently truncating source. Builders' Qwen-generated glue may still have runtime errors. These are limitations to test with a new Cloudflare run.

**Local verification:** 112+ Node tests, including deterministic fit calculation, one Root builder for a deep tree, provisional publication, recursive over-budget delegation to multiple manager subtrees, complete source copying and revision updates, and compact parent context when a delegated subtree contains nested `index.js` files. No live Cloudflare run was performed as part of this release.

---

## v6.2 — Builders link real implementations instead of writing new ones

This release addresses the v6.1 live run in which the Root builder claimed to assemble a ticket application but imported metadata as executable code, and other builders repeatedly tried to write `memory/public/knowledge.json` through the source-file API. Both failure modes came from treating builders as unrestricted implementers.

**The invariant is now: leaf workers write functionality; temporary builders retain its actual source and contribute only glue.** No new agent, Clef review, or separate verification stage has been introduced.

1. **Materialize real child source before inference.** When an existing temporary builder runs, the runtime reads each direct child's published source from the Artifacts write-through index and copies it byte-for-byte into its own repository under `components/<short-label>-<opaque-hash>/...`. An entire nested sub-builder's composable bundle is copied, including the inner worker files and their adapters. Namespace nesting preserves relative imports, including through multiple managers. The public alias must exist before a child manager's bundle is offered upstream; unpublished files cannot silently disappear from an ancestor's integration.
2. **Durable source inventory.** The room maintains a SQLite `builder_sources` copy index, recording source origin, destination and hash so unchanged revisions are not written again. `assembly.manifest.json` is generated deterministically in the builder's Artifacts repository. Its entries include the child branch's *label*, its published file path, destination path, and SHA-256 of the exact bytes. A manager itself still does not write production code. This remains room-owned materialization state, not a new independent manager scheduler.
3. **Small builder-only writes.** Qwen's temporary-builder prompt sees exact materialized paths, meaningful source excerpts, and a full file inventory. It may author only short `glue/` modules, thin entrypoints (`index.js`, `src/main.js`, etc.) and launch/config files (`package.json`, `index.html`, `vite.config.js`). It is instructed to call actual imported worker functions and report missing functionality to its manager, not invent another CRUD/storage/UI implementation. Source files under `components/` are not Qwen-generated, and builder-authored file content is capped at 5,000 characters per file. A builder turn can request up to four small glue/config files.
4. **Memory-write retry recovery.** Newly generated `files` actions targeting `memory/` are filtered before persistence. Older v6.1 pending actions containing invalid notebook `files` or `imports` advance past that operation without repeating the deterministic error; prior committed code remains intact. Knowledge must still use `remember`.
5. **Deep trees.** Public source paths can now be up to 512 characters (with individual path segments capped at 255). Short branch names plus opaque hashes prevent sibling-label collisions without embedding hidden agent IDs in public paths. Full code is preserved rather than cutting off names.

**Evidence:** 107 local tests pass. Added coverage includes byte-for-byte multi-file preservation, manifests, no-op same-revision copies, repeated source revisions, two-level ancestor propagation, an actual Node import-and-execute smoke test across two builders, reserved-memory recovery, unpublished-source visibility, and a ten-level path test.

**Limitations:** The content of Qwen's *glue* is not semantically verified or guaranteed to be runnable in a real Cloudflare deployment. This redesign preserves worker implementations and curtails builder reinvention; it does not repair missing functionality from a leaf worker or resolve all language/runtime mismatches automatically. The scheduler still dispatches worker turns from ControlRoom. The older `MOCK_AI` fixture retains its historical builder-import behavior for compatibility; new tests exercise the real materialization and builder prompt paths separately. A fresh live run is needed to evaluate end-to-end application assembly.

### Example integration package

```text
assembly.manifest.json             # runtime-generated provenance
components/storage-0f4.../        # source copied unchanged from Storage branch
  bundle/components/write-76.../write.js
  bundle/components/read-9a.../read.js
  bundle/glue/index.js             # prior builder's small adapter
components/ui-841.../              # source copied unchanged from UI branch
  bundle/...
glue/index.js                    # only wiring written at this level
package.json                     # optional launcher/config
```

If the Storage implementation is rewritten, only the affected materialized source and its manifest change before the builder reconciles that new revision. A producer can continue working while an ancestor builder integrates the latest published source.

## v6.1 — Top-down decomposition, continuous bottom-up integration

The v6.0 live export reached the Root builder but Qwen rejected a request of roughly 125k tokens against its 32k-token context. The real source was tiny; recursive manager aliases and repeated public manifests made it too large. The replacement pipeline operates at **every management boundary**, not only after all work finishes:

```text
           Root sub-builder  ◄── partial Storage package
                  ▲          ◄── partial UI package
      Storage manager sub-builder
         ▲                ▲
    Write worker      Read worker (still writing)
```

- **Start early:** When one direct child publishes any source, its manager schedules one reusable temporary builder. The other children keep writing. Root can integrate a provisional subtree without waiting for that subtree to finalize.
- **Integrate up the hierarchy:** Each sub-builder reads the **direct siblings'** public code and assumed contracts, imports source into its own Artifacts repository, writes an integrated module or app component, and publishes it via the manager's `bundle/` public alias. The manager remains prohibited from generating source code.
- **Revise by input fingerprint:** Each manager DO durably tracks the latest offered and completed *direct-child artifact fingerprint*. New child output or completed status wakes the same builder for a later pass, even if that builder already marked its previous revision `done`. A rewritten existing bundle file notifies its parent even when the alias path is unchanged.
- **Finalize last:** A manager can publish provisional code anytime, but only reports **final subtree completion** when its direct production children are finished and the reusable builder has incorporated their latest revisions. Root is no longer a one-time enormous assembly pass.
- **Avoid the alias explosion:** Manager relay planning forwards at most 16 canonical public paths per direct child, favoring its integrated `bundle/` once available. Qwen builders receive bounded code excerpts, compact public assumptions, and direct sibling manifests, rather than all descendant aliases. The underlying original files remain in their owners' Artifacts repositories.
- **Cache Artifact reads:** Published source and notebooks are read from the room's post-commit Artifacts mirror when available, with a legacy-repo fallback. No new Clef or review stage is introduced.

**Manager Durable Object responsibilities have expanded:** The manager shard now durably owns the pending routed ownership hops, an idempotent manager message inbox (with a room-to-shard compatibility projection for worker delivery), publication revisions, and the builder integration checkpoints. Each manager still runs its own Clef owner selection and public-interface planning. Parent managers see their direct child's public bundle, not the hidden decomposition that produced it.

**Scaling boundary that remains:** This is *not yet a fully decentralized scheduler*. `ControlRoom` still owns the global roster, dispatches Qwen leaf turns, performs Artifacts writes, and mirrors delivery events. Manager turns are invoked from that scheduler and await shard calls. To remove the last coordination hotspot, move per-manager dispatch/alarm scheduling and child-to-parent message transport fully into the shards. The integration hierarchy and manager-owned routing state are now ready for that step, but this release does not pretend it is already implemented.

**97 / 97 v6.1 local tests passed**, including provisional upstream composition while a sibling remains unfinished, later revisions waking the same builder, stale-revision finalization rejection, unchanged-path publication notifications, manager-owned inbox/route-hop persistence, and bounded alias/context propagation. Tests use simulated Cloudflare DO/Artifacts instances; live Cloudflare execution and the quality of the generated application still require a fresh test.

## Decision path

```text
New assigned behavior
  ├─ no room to allocate 2 children? ──> implement the full assignment
  └─ Clef-flash (single YES/NO decision)
       ├─ NO ──> implement now, during the same turn
       └─ YES ──> small Qwen guess: 2 or 3 complete child responsibilities
                    ├─ one Clef batch checks children vs Root goal + parent scope
                    ├─ reject out-of-scope children before creating repos
                    ├─ reserve all remaining child slots and provision repositories
                    ├─ success: permanently become manager
                    └─ rejected: remain leaf and implement entire assignment
```

A manager **never writes source** and cannot retire unfinished or production children. It only knows direct children, routes messages, persists public/private Artifacts knowledge, and exposes code through opaque aliases. All implementation belongs to leaf agents. **v6.3+ starts with one Root builder**, and activates sub-builders on manager subtrees only if the source exceeds the conservative context budget. A model implementer outside a manager's branch cannot navigate its descendants; only runtime materialization can collect cross-tree source for the privileged Root assembly.

The split decision defaults to `p(YES) >= 0.50`; change it between 0.20 and 0.80 in the GUI. **A low threshold makes the system more eager to split**, not more confident. Clef cannot prove a division is useful: the Qwen guess must still cover the full responsibility, and the runtime checks that it contains at least two distinct assignments. The 64-agent production cap and depth cap can still force oversized leaf work. Only context-required temporary builders are outside the production-agent cap. Splitting is a hypothesis to test, not a correctness guarantee.

The gate sends **only the assigned behavioral description** (up to 2,600 characters) and a short typed question. It does not load repositories, messages, or a global registry. If Clef returns an invalid response, the turn fails visibly and retries; it does **not** silently classify the problem as indivisible.

`split_gate` events record the YES/NO result, its probability, and elapsed time. The model inference and Artifacts operations are not benchmarked independently by local tests. The scheduler immediately dispatches another ready agent when any slot becomes free; it does not wait for a whole inference wave.

## v6.0 history — Per-manager Durable Objects plus a durable lost-wake fix

The v5.7 issue-tracker export stopped at step 115 with every production
branch marked `done`, Root marked `waiting`, and an empty queue. During an
in-flight Root turn, the last child completed and woke Root, but Root's
later `waiting` write erased the notification. This is a real scheduler race.

**Durable completion notifications and quiescence reconciliation:**

- Every `wake(agent)` increments an SQL-persisted per-agent generation
  *before* changing status and queue membership.
- Each manager turn captures its starting generation. If a child completes
  or a message arrives mid-turn, the manager is requeued after publishing
  its existing results; a stale turn cannot finalize a manager as `done`.
  This also captures late Artifacts writes that would otherwise be omitted
  from the parent-facing export map.
- At idle, the scheduler checks waiting managers whose direct children are
  all complete; it schedules a bounded reconciliation using the set of child
  statuses as the deduplication fingerprint. A previously paused v5.7 room
  may therefore recover when resumed on v6.0.
- **Historical v6.0 behavior:** Root waited until its production branches completed before spawning its sole builder. **Replaced in v6.1** by continuous per-manager integration.

**Independent manager Durable Objects:**

- The `MANAGERS` binding provisions one `ManagerShard` DO **per manager,
  per room, per experiment**. A new experiment gets a unique run nonce, so
  a previous run in the same room cannot poison a new manager's state.
- Each manager DO has its own SQLite database and owns its direct-child
  progress snapshots, pending signals, lifecycle decisions, public export
  *planning*, public assumption *planning*, and Clef ownership selection.
  Different managers can execute these tasks concurrently in separate DOs.
- The `ControlRoom` DO remains the global execution coordinator and public
  file/export projection. It still schedules **workers**, persists the
  routing and Artifacts manifest indexes, commits planned aliases/knowledge,
  and exposes the existing HTTP dashboard API. Existing privacy constraints
  and the v6.0 Root-only builder behavior was unchanged *in that release*; v6.1 replaces this with recursive integration.

**Scaling boundary:** This is a genuine per-manager DO deployment for manager
planning and ownership classification, **not** yet a fully decentralized
scheduler. Global worker dispatch, message transport, and the export index
still use the room coordinator, so one room can still hit that bottleneck.
A fully sharded scheduler would require migrating those operations too.

**90 local tests pass**, including timed concurrent completion, quiescence
recovery, isolated manager SQLite state, independent manager exposure
planning, and previous behavior. Tests use simulated DO stubs. Cloudflare
live Durable Object RPC, deployment, and performance are not verified.

## v5.9 — Incremental JSON export without GET fan-out

The dashboard previously built the raw JSON export with `/api/state` followed by
one `/api/file` request **per physical file and virtual manager alias**. Deep
trees repeated reads of the same underlying source through several aliases.

- A successful Artifacts write now also updates the room Durable Object's
  SQLite-backed `artifact_contents` export index. Failed Git writes do not enter
  that index; revisions replace the indexed content.
- One authenticated `GET /api/export?room=...` returns the complete raw JSON
  snapshot, all registered physical files, and all public aliases resolved
  from their underlying indexed source. Export includes files beyond the
  dashboard's 240-source-item display limit.
- **Fresh v5.9 room exports perform no Artifacts file reads.** Aliases reuse
  the indexed original, even across multiple manager levels. Earlier rooms
  without the index hydrate each physical file from Artifacts on first export;
  subsequent exports reuse the mirror.
- The browser makes **one HTTP request**, rather than thousands of per-file
  requests. The output remains an ordinary JSON download with file contents.

This is a write-through room-level export index. v6.0 additionally shards
manager planning and ownership selection into separate Durable Objects, while
retaining the room-level file index and worker scheduling.

**84 local tests pass**, including zero-read exports, nested aliases, revision
updates, rejected Git writes, and legacy cache hydration. Live Cloudflare
performance and large-export memory usage remain unverified.

## v5.8 — Collision-safe public assumption keys

The v5.7 manager relay used `assumed_<child label>_<child key>` and then
truncated the result to 100 characters. Three manager hops could turn distinct
provisional contracts such as `assumed_ticket_api` and `assumed_ticket_schema`
into the same key, overwriting one of them before the temporary builder saw it.

- **Strip the redundant inner `assumed_`** (or `assumption_`) prefix from a
  child's note before adding the current manager's label-scoped prefix.
- **Keep the full key's identity.** If the resulting key exceeds 100 characters,
  publish the first 87 characters followed by `_` and 12 lowercase hex digits
  from SHA-256 of the *entire* untruncated key. This preserves both entries
  across multiple manager hops without exposing private child IDs.
- Assumptions remain **public Artifacts knowledge**. Managers still only read
  their direct children's public notes and do not write or validate source.
  No new model calls, reviewers, or scheduler changes.

**Known demo-size limits remain unchanged:** each manager relays only the last
12 assumption notes per direct child, each public notebook retains 60 entries,
and the temporary builder's context includes at most 12 assumptions per neighbor.
Thus this fix prevents **key collisions** but does **not guarantee complete
assumption delivery in large trees**. These are separate limits, not silently
resolved by hashing. Local tests are mocked; live Cloudflare deployment and
end-to-end generated-app correctness are not verified.

**80 local tests pass**, including multi-hop preservation of sibling assumptions,
collision-resistant long-key suffixes, and stable relay when managers run again.

## v5.7 — Owner discovery is sufficient to proceed

A worker asking whether an **external behavior is owned** no longer waits for the owner to publish source, use the same filename, or agree on an interface signature. Managers route by direct-child responsibility (including deterministic explicit owner addresses) and Clef when necessary. As soon as a responsible branch is identified, a manager immediately replies with `[route:owned]` using the existing request ID. The worker can assume a plausible contract, publish that assumption as public `assumed_*` knowledge, implement its task and finish. The temporary Root builder reconciles mismatched signatures during final assembly.

- The ownership confirmation **does not include child IDs, source code, or an invented interface**. It is not stored as a schema or an API contract. Published exact answers may still be returned when already available, but **source or interface-key matching is not a prerequisite for an ownership acknowledgment**.
- Replies traverse the same parent/child route breadcrumbs and wake the sleeping requester. Pending v5.6 routes with a previously identified direct-child owner also complete as soon as their manager runs again; no source publication is required.
- If no owner is identified, existing behavior is unchanged: the request searches upward; explicitly nonexistent destinations fail, while uncertain semantic ownership stays pending rather than killing a potentially valid worker. Manager/worker scope boundaries and the Clef splitting gate are unchanged.
- Real implementers' prompts explicitly treat `[route:owned]` as sufficient to resume and complete against an assumed contract. A worker that needs no ownership confirmation should skip the question and implement immediately.

**78 local tests pass**, including the previously stranded ticket-display/retrieval dependency, explicit ownership without published files, cross-branch routing without leaking descendants, persistent in-flight routes, and historical pending-route recovery. All inference and Artifacts behavior in tests is mocked; the generated application and live Cloudflare execution have not been verified.

## v5.6 — Assumption-first implementation (no approval deadlock)

**A worker owns its assigned behavior, including provisional design decisions about unavailable external interfaces.** If another branch has not published a contract, the implementer guesses a reasonable minimal one, writes working code against it, and publishes its guess using `remember:[{"visibility":"public","key":"assumed_ticket_api","value":"Provisional: PATCH /api/tickets/:id, JSON patch body, returns updated Ticket"}]`. The final Root builder reconciles mismatches between branches. No Qwen verification agent or extra Clef classification is introduced.

- **No automatic block on `ask`.** The v5.5 runtime forced `wait:true` and cleared `done:true` for *every* Qwen `ask`. Now it respects an explicit `wait:true`: a truly unguessable dependency may still route and block, with independent files retained. When `wait:false`, optional `ask` entries are skipped rather than creating outstanding routes that could block Root's builder. Implementers can finish with `done:true` the same turn they publish code and public assumptions.
- **Managers expose assumptions as public knowledge, not source.** Each manager reads only its **direct children's** public `assumed_*`/`assumption_*` notes, publishes label-scoped provisional facts in its own Artifacts public notebook, and returns those up the tree. Private child IDs are never embedded in the exposed keys. The temporary builder gets recent sibling public assumptions in its prompt, even if newer routine notes exist. The `generateFile()` prompt also sees the implementer's own saved assumptions in that same turn.
- **No changes to ownership hierarchy, recursive Clef split/scope tests, builder timing, or manager code prohibition.** Guessing is a speed/availability bet, not an assertion that a guessed contract is correct or that generated code runs. Actual Cloudflare inference and end-to-end application behavior are unverified.

**75 local tests pass**, including a guessed-interface worker completing without generating a blocking route, public assumption propagation through multiple managers, builder visibility without descendant-ID leakage, and a genuinely blocked worker resuming after the answer arrives.

## v5.5 — Workers execute their own responsibility

A spawned implementer owns its entire assigned behavior, including local design choices, defaults, formats and internal interfaces. **Managers are routers, not approval authorities.** Workers communicate upward only to answer incoming questions or request a concrete interface or fact owned by another responsibility. They do not ask their manager which presentation format to choose or how to implement their own assignment. The file-generation prompt reinforces the same ownership contract.

**Historical v5.5 runtime correction (superseded for optional asks in v5.6):** In v5.4 any nonempty `ask` from a real implementer silently erased `action.files` and `action.imports` before executing the action. In v5.5 every external-interface request postponed `done`, but independently implementable `files` are generated and committed to the worker's own Artifacts repo **in that same turn**. The worker then sleeps awaiting the external answer, and resumes when it arrives. The temporary builder's existing direct-import privilege is unchanged; regular implementers still cannot import another branch's files. A worker should not emit dependent placeholders while waiting.

No new Clef gates, supervisory reviews, verification agents, model calls, or manager compilation were added. The split and recursive scope-admission protocol from v5.4 is unchanged. **Prompt changes encourage the correct ownership behavior, but cannot guarantee that Qwen will never ask an unnecessary question.** This release does not resolve every route-uncertainty deadlock or establish generated application correctness.

**73 local tests passed in v5.5**, including scoped independent file publication on a turn that also requests an external interface, the external answer subsequently waking the worker to finish, a worker completing without manager permission, and ownership requirements in both the decision and file-generation prompts. Tests use mocked inference/Artifacts; live Cloudflare behavior and generated application functionality have not been verified.

## v5.4 — Lazy recursive scope admission

Qwen still proposes 2–3 behavioral subproblems after the existing Clef split gate. **Before allocating any child**, the runtime sends ONE batched Clef `noul` request with the unchanged original user goal, the direct parent responsibility, and the proposed child descriptions. Clef evaluates whether *each* proposed child is within **both** scopes. It does not generate code, perform a lengthy review, inspect repository contents, or decide whether a worker's implementation is correct.

- `p(within scope) >= 0.50` admits that proposed child; lower scores reject it. The scope threshold is fixed, separate from the GUI's *split* threshold.
- Rejected children do not create agents or Artifacts repositories. An accepted 2+ child split proceeds normally; if too few admissible children remain, the entire assigned responsibility stays with the original worker rather than installing an incomplete manager. Root's already-deferred final assembly remains a special case.
- Every recursive split repeats this check against **the original Root goal, not merely the parent**. This prevents successive vague responsibilities from legitimizing an unrelated branch (for example, banking transfers under ticket ownership).
- The same scope check applies to a late Qwen `spawn` action from an implementation turn. Invalid Clef output fails visibly; there is no silent default admission.
- **Scope checks do not review generated source code.** A scoped leaf can still write broken or irrelevant code; this version does not pretend to solve correctness or stalled completion. There is no additional Qwen review loop and no manager compilation step.

**70 local tests pass**, including rejection of out-of-scope proposed children at nested depth, correct preservation of accepted siblings, full fallback when all proposals fail, late splitting, and invalid Clef responses. The tests use mocked inference/Artifacts; live Cloudflare inference is unverified.

## v5.3 — Deterministic owner routes, uncertainty-safe routing and deferred assembly

This release fixes the live failure where `root.3` requested `interfaces/root.1` and
Root marked the request out of scope despite `root.1` being its direct child.

- **Explicit routes are authoritative.** A key such as `interfaces/root.1` routes
  deterministically to `root.1` using the private direct-child ownership table.
  Clef is not called for this next hop. A manager never lists or exposes the
  destination's private descendants.
- **Owner known, artifact pending means WAIT.** If `root.1` has not yet exposed
  its interface, its manager keeps the request pending. Once its children publish
  public files, Root receives the public file list and bounded source excerpts
  through the normal return route. No Qwen worker polling is required.
- **Uncertain is not out of scope.** An ambiguous semantic question with no
  Clef match now produces `route_uncertain` and stays pending. On newly published
  Artifacts it is retried as a read-only lookup. An **explicit nonexistent
  destination** such as `interfaces/root.999` is genuinely unreachable and
  produces `scope_rejected`. Semantic scope rejection is intentionally
  conservative to prevent false kills; an unknown semantic request may remain
  pending until a matching owner publishes evidence. This is not a proof of
  general semantic out-of-scope detection.
- **Assembly only after production.** An initial Root split that proposes an
  application-integration-only strand defers that strand (even when just one
  actual production strand remains). Root creates its
  temporary builder only after its production children have finished. The
  runtime also blocks manually spawning a `Temporary builder` outside that
  completion path.

**65 local tests pass**, including the exact explicit-route regression, an
unpublished interface subsequently arriving, uncertain classification remaining
pending, an explicitly absent destination failing, and early integration being
reserved for the final builder. Model calls and Artifacts writes are mocked;
not yet live-verified on Cloudflare.

## v5.2 — Historical hierarchical knowledge routing (superseded by v5.7)

Workers no longer search the ownership tree or address sibling agents for missing information. **Only when a Qwen implementer truly cannot make a viable interface assumption, it issues `ask: [{"key":"schema_definition","question":"What is the ticket schema?"}]` with `wait:true`**, with **no recipient ID**, and then waits. In v5.2 the runtime discarded all proposed files upon asking; v5.5 preserved independent files, and v5.6 makes interface assumptions preferable to waiting. The implementation model sees its assignment and manager, not a roster of sibling owners.

Each manager is a **Clef-assisted next-hop router**, not another Qwen programmer:

1. Check its own public Artifacts knowledge. Only published answers count; a question, placeholder such as `<schema_definition>`, or `pending` is **not** cached as an answer.
2. Inspect the public knowledge and exposed files of immediate children. For a relevant published file, read its actual content rather than waking a child to explain its own repository.
3. Choose the relevant direct child via an unambiguous lookup or Clef ownership classification. If the child owns the information but hasn't published it, retain the request and wait for its Artifacts updates. **Do not wake a leaf to repeatedly ask it.**
4. If no local branch owns the topic, escalate to the parent manager. At each higher level, sibling owner branches become discoverable. External agents never address or inspect hidden grandchildren; their owner resolves the question.
5. **At Root, a genuinely nonexistent explicit destination** is rejected with `scope_rejected`. A semantic question without a confident route remains pending instead of failing a valid worker on Clef uncertainty. See the v5.3 routing semantics above.

Requests and replies have separate message types with **opaque request IDs** and persistent SQLite next-hop breadcrumbs. Answers retrace the same path, are cached publicly by managers in Artifacts, and wake the worker exactly when resolved. Duplicate unanswered asks use the same pending request ID. Outstanding requests survive Durable Object eviction. Work queues exclude workers blocked on an outstanding request from quiescent Qwen nudges. Newly published public files wake the manager waiting for them.

**Routing example:** `root.2.1.1.1 (worker) → root.2.1.1 → root.2.1 → root.2 → Root → root.1 (storage owner) → published schema`, then the answer returns along the reverse path. The requester receives only the schema, not the identity or private repository of the schema-owning descendant.

Temporary builders still assemble public sibling artifacts; ordinary implementation workers cannot import code from sibling repositories through Qwen actions. Managers cannot implement code. New sessions use v5.3's routing contract; **start a new room** when evaluating this change, since old rooms may contain legacy, untyped `[knowledge:...]` requests and cached question-text facts.

### Regression validation

**65 local Node tests pass**, including tests for multi-hop schema routing, unpublished in-scope answers that remain pending, explicitly missing-owner worker failure, persistence of a route across Durable Object reconstruction, and historical worker `ask` blocking behavior (superseded for independent files by v5.5). Workers AI and Cloudflare Artifacts calls are mocked; this is **not** a claim of live Cloudflare deployment or end-to-end working generated software.

## Managers are repository-backed routers (v5.1)

A manager **never calls generative Qwen inference**. Its direct children are already known from
its own private `memory/private/ownership.json`. On manager activation, the runtime reads **only
its direct children's public Artifacts knowledge and exposed file manifests**. It automatically
publishes stable, opaque aliases (short unique paths and label-scoped paths) under the
manager's public interface. The actual child IDs are kept in the manager's PRIVATE
`memory/private/exports.json`. No remote peer can see or address a grandchild.

For an incoming question the runtime tries, in order:

1. An exact public Artifacts knowledge hit (no model).
2. A fresh repository map from public file manifests (no model or child message).
3. An existing child public topic or published source containing the answer; basic HTTP
   method/path mappings are recovered from public route definitions without asking the child.
4. Clef-flash as a **classification-only router**, scoring the direct-child responsibilities,
   public topic keys, exposed paths and bounded source previews. On a genuine miss, forward
   only to the selected child, then publish the returned knowledge in the manager's own Artifacts.

Maps are live views, not permanently cached descriptions: publishing new files refreshes
repository-map answers automatically. When children complete, manager completion is determined
by the runtime; Root automatically spawns the temporary builder after production strands finish.
Manager housekeeping does not consume generative agent-turn budget. As before, the runtime
blocks all manager code generation, imports, and source rewrites. Clef itself cannot execute
repository reads; the Worker reads Artifacts and passes a small classification state to Clef.

**Caveat:** The route classifier and Artifacts REST/Git calls have local/mock coverage only.
No authenticated live Clef routing call or live Cloudflare deployment was executed here.
Automatic source inspection only extracts explicit common HTTP route patterns, not arbitrary
code semantics. Other questions fall through to Clef and, when actually necessary, the
responsible child.

## Install and deploy

See **[INSTALL-CLOUDFLARE.md](INSTALL-CLOUDFLARE.md)** for the complete v6.6 first-time install, Cloudflare prerequisites, and safe upgrade steps. Node.js 22+, Workers AI, Artifacts, Containers, Docker Engine, and Wrangler authentication are required.

```bash
unzip qwen-recursive-control-plane-v6.6-builder-loop-fix.zip
cd qwen-control-plane-v6.6-cloud
npm install
npm test
npm run check
npx wrangler login                # skip if already authenticated
npx wrangler artifacts namespaces get default
docker info
npm run deploy
# Only if not already set for the existing qwen-control-plane-v4 Worker:
npx wrangler secret put APP_TOKEN
```

Open the URL printed by Wrangler. In the dashboard, choose your generative model, choose Clef-flash/Clef for split decisions, adjust the split probability threshold, concurrency, agent count, recursion depth, and turn budget, then start a **new** room to test the changed defaults. Continuing an old room retains the old agents and their previous decomposition state.

## Validation and limitations

**120 Node tests pass in v6.4**, including manager/implementer isolation, opaque Artifacts routing, async scheduling, recursive scope admission, persistent-action recovery, and worker ownership/dependency regressions. `npm run check` runs JS syntax validation.

Tests mock Cloudflare Workers AI and Artifacts. **No live model inference, account-level throttling, real Cloudflare Artifacts pushes, generated application execution, or end-to-end application correctness have been verified here.** The very small 1B model is especially experimental. The provided mock run is deterministic and bypasses Clef so that the existing repository/integration regression suite remains stable; new tests exercise the Clef call separately.

## Sources for the model IDs and API contracts

- https://developers.cloudflare.com/workers-ai/models/clef-flash/
- https://developers.cloudflare.com/workers-ai/models/clef/
- https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/
- https://developers.cloudflare.com/workers-ai/models/llama-3.2-1b-instruct/
