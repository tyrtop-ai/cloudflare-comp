# v7.13: fixes from the live runs, v7.13.0 to v7.13.4

## What changed

v7.13 is one release and four hotfixes, plus the export connector. Each answers a live run on a real Cloudflare account. Every live run used the issue-tracker goal, Qwen3-30B-A3B for the splitter and the workers, and Clef-flash for the gates. Rooms are named by the first 8 characters of their ID.

| Version | Motivated by | What it fixed | Next live run on it |
|---|---|---|---|
| v7.13.0 | run 3 and run 3b (11cbd6ef, v7.12), e89dba35 (v7.11) | Prune on discovery, the entry contract and a check before the runner, threshold 0.7, a plain-Node splitter, a third binding fix and the import alias, builders that read their children's boundaries, the circles dashboard | run4 (26fadbdb) |
| v7.13.1 | run4 (26fadbdb) | A static runner test, the `start()` sentence appended to the goal, placeholder split labels turned back, a lone generic handler caught | run5 (f73243d3), run6 (9642ff74) |
| v7.13.2 | run5 (f73243d3) | One wiring style: imports only, and `start()` takes no arguments. Stop | none |
| v7.13.3 | run6 (9642ff74) | The API coverage gate before the runner's test, the alias on a name collision, linker and scope prompt sentences | run7 (4203fa2a) |
| Export connector | getting a run's code out | Download app (.zip) and `POST /api/export/github` | first used live in run7 |
| v7.13.4 | run7 (4203fa2a) | The export surface of an immediately invoked function, a fourth binding fix, robust reading of model output, `/no_think` for the runner and coverage calls, output heads in events, one automatic runner retry | run8 (48a10b1d) |

What run8 showed on v7.13.4 is fixed in v7.15, not in a v7.13 hotfix. See [CHANGELOG-v7.15.md](CHANGELOG-v7.15.md).

No live run has used v7.14 or v7.15, and no live run has yet finished with a correct, verified application.

v7.14 builds on v7.13.0 and changes three parts of it:
- It removes the entry marking. The `start()` requirement moves into the goal, and the entry checks move into the compiler.
- It shortens the prune notes.
- It fixes three defects that a review of v7.13 found.

The v7.13.1 to v7.13.4 hotfixes were made on the live line, which still had v7.13's Root-centred builder. They were then ported into v7.14's layout, where the compiler runs their checks and files what they find with Root. See [CHANGELOG-v7.14.md](CHANGELOG-v7.14.md). Each point that v7.14 or v7.15 changed is marked below.

## v7.13.0

Two live v7.12 runs (room 11cbd6ef) stopped short of a passing application. Both used the same goal.

- **Run 3**, at split threshold 0.5, grew to 70 agents: 63 workers and managers and 7 builders.
  - Seven splits were blocked for capacity.
  - Subtrees rebuilt what other strands owned.
  - A React worker failed to parse three times and paused the room at 126 seconds.
- **Run 3b**, at threshold 0.7, split into 9 flat workers.
  - Root's builder sent 12 problems back to workers, then 1, then 6.
  - Its final link at step 49 started an entry module that exported nothing: `start()` returned `{"type":"object","members":{}}`.
  - The runner failed three times, the room paused, and no worker was told why.

v7.13.0 answers both runs. It was built as four branches on v7.12:

| Branch | What it adds |
|---|---|
| prune | Prune on discovery |
| entry-splitter | The entry contract, the 0.7 threshold and the plain-Node splitter |
| linker-alias | A third binding fix and the import alias |
| boundaries | Builders that link against their children's boundaries |

Each branch had a review, and each review led to a fix commit. The dashboard became an ownership tree of circles in the tyrtop.com palette.

### Prune on discovery

**Live evidence, run 3.**
- Clef's scope check admits a proposed child when it fits the Root goal and its parent's assignment. Nothing asked whether another strand already owned it.
- "View Ticket Service" (root.4) spawned `Ticket.ts`, `TicketRepository.ts` and `TicketRepositoryImpl.ts`. Root's children "Ticket Interface" and "In-Memory Ticket Repository" already owned them. All five of root.4's proposed children passed the scope check, at p 0.66 to 0.93.
- "Update Ticket Service" nested down to an "Application Entry Point" four levels deep.
- "Create Ticket Service" nested down to the React "TicketForm Component" that paused the room.

**Fix.**
- After the scope check admits a manager's children, and before any of them is spawned, each child's topic (label and task) is walked up the tree. This applies to every manager except Root.
- At each level, starting at the manager's parent, Clef's strict owner routing picks among that level's direct children, including the asking branch. Builders are not candidates.
  - If the asking branch owns the topic, it keeps the child (`scope_kept`).
  - If another branch owns it, the child is pruned (`scope_pruned`), and the event names the owner.
  - If no owner is confident at this level, the walk moves one level up.
  - If no strand owns it, up to and including Root, the child is killed (`scope_killed`).
  - A Clef error counts as no owner at that level and never kills. A child that nothing owned is then kept (`scope_walk_uncertain`).
- Pruned and killed children count as scope-rejected. The existing viability rule, split feedback, Clef's reconsideration and Qwen's correction apply to them.
- The feedback names each pruned child's owner ("X is owned by Y; import it from that strand"). A split that is spawned records those notes as the manager's `owned_elsewhere` knowledge, which its new children see. A leaf's late split is walked the same way.
- The walk calls Clef at every level, with no keyword shortcut. The shortcut favoured the asking branch, because a child's task repeats its parent's words. On run 3's own text, it would have kept `TicketRepositoryImpl.ts` in View Ticket Service (four shared words against one) without asking Clef.
- Cost: one Clef call per level per admitted child, children in parallel. On run 3's tree that is at most 128 calls over 14 splits below Root, with 55 children. Run 3b's flat tree has no walk at all.

**Review fixes (4bfa541).** The owner notes were missing or wrong in five places:
- A manager whose split pruning left non-viable, and which Clef then sent to direct implementation, lost the notes. The leaf rebuilt the pruned pieces. The notes now go into the leaf's private memory.
- The note was written after the children were provisioned, so an early child could run without it. It is now written before the spawn.
- A corrected split that spawns a piece pruned on an earlier turn no longer tells that child to import itself.
- A pruned piece's work that its owner does not do stays in the strand. In run 3's root.4 split, `TicketRepositoryImpl.ts` carried the only status and search filtering, and its owner had none.
- A late split that pruning left below two children no longer loops without feedback.

v7.14 shortens the notes kept in memory (41a6f8c). v7.15 adds a walk by function name before the Clef walk, and a child that carries a function its parent promised skips the Clef walk.

### The entry contract and a check before the runner

**Live evidence, run 3b.**
- Root's splitter prompt carried the `start()` contract, but the contract never reached the entry worker's task. Root.9 was asked to "create main module that initializes repository, parses commands, and starts CLI controller".
- Its `app.js` read `process.argv` and dispatched a CLI at module load, and it exported nothing.
- The model named it as the entry, and the Container loaded it. `start()` returned `{"type":"object","members":{}}`.
- The runner failed three times, and the room paused with `runner_failed`.
- Only `undefined`, `null` or an error from `start()` had gone back to the entry worker. So no worker heard this problem.

**Fix.**
- Root's builder checks the chosen entry's export surface before any Container run. An entry known to lack `start()` goes to its worker with `ENTRY_CONTRACT`. A default class with a static `start()` counts as having one.
  > You write the application entry module: it imports the other pieces by the relative paths and names it expects, wires them together and exports start(); start() returns an object whose methods perform the application's operations. It does no work at module load: importing it must not read process.argv, start a server or prompt for input.

  v7.13.1 and v7.13.2 reword this contract; the text in force is quoted under [v7.13.2](#v7132-one-wiring-style).
- Exports set by a call, a spread, a re-export or an imported instance may hold `start()`. Those modules go to the Container, which decides (84f4ff9).
- After the Container starts the application, `start()` must have returned something to call: a function or class, or an object or array holding one at any depth. Otherwise the problem goes to the entry worker, and the runner is not asked.
- Root's splitter marked one entry child with `"entry":true`. The runtime appended `ENTRY_CONTRACT` to that child's task and recorded it as `entry_child`, so entry problems went to its module first. When no child or several children were marked, `entrySpec` chose one by its label and task.
- **v7.14 removes this marking.** See "Root is the final stop" in [CHANGELOG-v7.14.md](CHANGELOG-v7.14.md). In v7.15 the runtime records which child carries `start` as that child's promise, and the compiler reads it.

**Checked.** This is a replay of run 3b's final Root link at step 49, with the nine final worker sources.

| Version | Linker calls | Container runs | Runner calls | Result |
|---|---|---|---|---|
| v7.12, as live | 1 | 1 | 3 | `runner_failed`, with no worker blamed |
| v7.13, with root.9 recorded as the entry child | 0 | 0 | 0 | The contract goes to root.9 |

### Split threshold 0.7

**Live evidence.**
- Run 3, at 0.5, reached the 64-agent cap.
- Run 3b, at 0.7, split into 9 flat workers.

**Fix.** The default split threshold is now 0.7. This applies to new rooms, to the Clef gate's fallback, to the `ManagerShard` default, and to the dashboard slider and its snapshot fallback. A room with its own threshold keeps it.

### A plain-Node splitter

**Live evidence.**
- In run 3b, root.1 was told to "Write TypeScript interface for Ticket". Its `.ts` output was rejected twice.
- Run 3 split into `Ticket.ts` files, the React "TicketForm Component" and an Express "Route Configuration".
- Leaves already refuse all of these, so such children could not succeed.

**Fix.** The splitter prompt says that the application is plain Node.js with built-in modules only:
- no TypeScript, interfaces or `.ts` files;
- no UI frameworks or JSX;
- no web servers, web frameworks, databases or drivers, unless the goal asks for them.

### The linker: a third binding fix, and the import alias

**Live evidence, run 3b.**
- `commandDispatcher.js` bound three handler modules whole and kept them in a handler table, for example `const createTicket = require(p)`.
- Those modules export only `{ addTicket }`, `{ getAllTickets }` and `exports.updateTicket = …`, so the handler could never run. `app.js` failed the same way at step 31, with "dispatchCommand is not a function".
- The builder renamed the key of a destructured import without renaming its uses. For example, it changed `{ addTicket }` to `{ createTicket }`. Each such edit was rejected as "edit renames "addTicket" in some places but not at token 100".

**Fix (602e5e8, 9aed940).**
- **The third binding fix.** `const x = require(p)` becomes `const { m: x } = require(p)`, or `const { x }` when `m` is `x`. For an ES module with no default, `import x from p` becomes `import { m as x } from p`.
  - This applies only when `p` exports exactly one member and it is a function or class.
  - The file must use `x` only as a function. It may call it, test it, keep it in a variable, or keep it in a handler table that is read only by key.
  - A member read, a table entry's member, or the binding passed to a call, put in an array, returned or exported leaves the binding alone (9aed940).
- **The import alias.** When an edit renames `{ a }` to `{ b }` without the file's uses, `applyEdits` writes it as `{ b: a }`, or `import { b as a }`. It keeps the edit if that passes the rename check.
  - The import must still name the same module, and that module must export `b` and not `a`.
  - The alias is tried only when the find text occurs once.
- `LINKER_SYSTEM` lists the three binding shapes the runtime fixes.

**Checked.**
- `test/linker-alias.test.js` uses run 3b's and run 3's worker files. It reproduces the live rejections at tokens 100, 21, 69, 76 and 37.
- A branch of run 3b's command modules links with no model call, and its linked dispatcher runs create, update, view and delete.
- Replaying run 3b's Root inputs at step 49 adds the three binding fixes and nothing else.
- The live run 3, run 3b and e89dba35 builder inputs give no other new fix.
- Run 3's step-106 edit that pointed `{ Ticket }` at `ticketToJson.js` is still rejected.

### Builders link against their direct children's boundaries

**Defect.** A manager child reached its parent's builder as its builder's whole linked bundle. The parent's linker model therefore saw every module of that bundle, however deep. Root's prompt grew with the whole tree, not with Root's own children. Run e89dba35's Root, at step 101, sent paths four `components/` levels deep.

**Fix (04e4d2d, dfe5556).**
- Every branch builder publishes `assembly.boundary.json` beside its bundle. It lists the modules the branch offers, each with its surface, and every import that does not resolve inside the branch.
- The level above shows its model one block per branch built below, holding only the modules that branch offers.
- A file to link inside such a branch goes to the model as an excerpt: the imports it must fix, the lines that use them, and the lines an error names.
- An edit whose find text also occurs outside the excerpt is refused.
- `autoLink`, the binding fixes, the static checks, entry choice, provenance and the manifests still read the whole bundle.

**Measured.** These replays use a model that proposes no edits, unless stated.

| Replay | Request before | Request after |
|---|---|---|
| e89dba35 Root inputs at step 101 | 7,668 characters | 5,686 characters (−26%) |
| Run 3 | 15,282 characters | 14,560 characters |
| A composed branch: a store and K helpers it imports | grows from 1.9k (K=2) to 9.0k (K=24) in v7.12 | stays near 1.3k |

In the e89dba35 replay, the unresolved imports, the mismatches, the linked files and the routed problems are identical to v7.12.

### Dashboard: the ownership tree as circles, in the tyrtop.com palette

- Every agent is a small circle coloured by its role: manager, worker or compiler.
  - A hollow circle is working, a solid one is done, and a pulse means it is running inference.
  - A manager's circle splits in half, manager and builder, while its builder is at work on the branch.
  - The lines under a manager turn green once every direct child is done. A branch its builder has linked gets a green ring.
  - Names show on hover. Click a circle to see its task, repository, summary and, for a manager, its builder.
- The stylesheet uses tyrtop.com's colour tokens. It switches to the dark set when the system prefers dark, and `html[a="dark"]` or `html[a="light"]` forces either one.
- Asset URLs were `?v=7.13.1`. Later dashboard changes are listed [below](#the-dashboard-after-v7130).

### What the one live run on v7.13.0 showed

Run4 (room 26fadbdb, threshold 0.7) did not complete. Its export was taken at 325 seconds. By then:
- Root's builder had sent problems back six times;
- the Container had started the application five times;
- the runner's test had failed five times.

It showed four problems, which v7.13.1 answers:
- **Clef rejected the entry child.** Clef's scope check rejected Root's proposed "Entry point module" child at p 0.346, because the goal never mentions an entry. No child got the contract. The entry fell to `createTicketHandler.js`, whose `start()` returned a lone `handler(event)`.
- **The runner wrote a new test for every repair round** (expecting 200, then 201, then a returned object). The worker chased a moving target.
- **The prune walk killed placeholder pieces.** Root.2's split came back as "Piece A" to "Piece E", copied from the prompt's example. The prune walk could place only one of them and killed the other four.
- **A lone handler passed the check before the runner.** `start()` returning a single generic handler counted as something to call.

## v7.13.1: a static runner test, `start()` in the goal, specific split labels

Motivated by run4 (26fadbdb), above. Commit d2af5e3.

- **The runner's test is static.** The first test that runs in the Container is the specification for the rest of the run, and it is never rewritten. Only a test turned back before it ever ran is written again. A later failure goes to the module triage names, else to the entry module. The test stays in the application as `glue/smoke.js`.
- **`start()` is part of the goal.** When a run starts, the runtime appends one sentence to the goal: the finished application has one entry module that exports `start()`, returning one method per operation named in the goal. Clef's scope check reads every child against the goal, so it now sees the requirement too. In run5 the entry child was kept; in run6 Clef rejected it again (p 0.448), which v7.13.3's scope sentence and v7.15's promises address. On the live line, Root's splitter still marked an entry child; v7.14 removes that marking.
- **One method per operation.** `ENTRY_CONTRACT` now asks for one method per operation the goal names, each named after that operation, not a single generic handler or dispatcher. A `start()` whose only member is a generic `handler`, `dispatch`, `run` or similar goes back to the entry worker before the runner is asked.
- **Placeholder labels are turned back.** A split whose labels or tasks are placeholders ("Piece A", "Part 2", or the prompt's own example) gets one retry in the same call, with "be more specific", before Clef or the prune walk sees it. The prompt's example no longer offers a label to copy.

Tests: `test/decomposition.test.js`, `test/split-recovery.test.js` and `test/v711-builder.test.js`.

**What run5 and run6 showed on v7.13.1.**
- **Run5 (f73243d3)** was looping after 8.5 minutes and 4 repair rounds.
  - What worked: the `start()` sentence kept the entry child. Prune on discovery worked live: 3 pieces were pruned to their owners and 2 unowned pieces were killed. The builders linked bottom-up with boundaries.
  - What failed: the workers used three wiring styles that renaming cannot reconcile. The store exported a factory, the handlers imported the store module directly, and the entry called `handler.start(store)` to inject it. The builder paired `updateTicket.start(store)` with `updateTicket(id, updates)`, and `start()` failed.
- **Run6 (9642ff74)** was marked complete in 3 minutes, falsely.
  - Clef's scope check rejected Root's entry-module child (p 0.448), and the entry problem went to the ticket retrieval worker.
  - Its `start()` returned only `{ getTickets }` for a create, view, update and delete goal.
  - The runner, told to use only the names in the API, tested reading alone. Its test passed, and the run was marked complete.
  - Along the way, the builder looped on a rename that collided with a name the file declared, and the linker bound `createTicket` to `saveTickets`.

## v7.13.2: one wiring style

Motivated by run5 (f73243d3). Commit dd6af7e.

- **Imports only.** Workers get collaborators only by importing them: never as parameters, factories or a `start(...)` of their own. They export plain named functions and keep shared state at module level, in the module that owns it. The worker prompt no longer says "you may also receive collaborators as function or constructor parameters", since builders can only link imports.
- **`start()` takes no arguments.** The goal sentence and `ENTRY_CONTRACT` say so, and that `start()` returns the operations the entry imports. This is the goal sentence the runtime still appends, with v7.14's clause on module load:
  > The finished application has one entry module that exports start(); start() takes no arguments and returns an object with one method per operation named above. Modules get what they need from other modules only by importing it. Importing a module does no work at load: no reading process.argv, starting a server or prompting.

  And this is the entry contract that entry problems still lead with:
  > You write the application entry module: it imports the other pieces by the relative paths and names it expects, exports start(); start() takes no arguments and returns an object with one method per operation the goal names, each named after that operation (create, view, update and delete for a goal that names those) and each the operation imported from the module that owns it, not a single generic handler or dispatcher. It does no work at module load: importing it must not read process.argv, start a server or prompt for input.
- **Stop.** `POST /api/stop` dispatches no new turn. Turns already running finish, then the run pauses with a `stopped` event, and Continue resumes it. While a run is going, the dashboard's Start button becomes a Stop button.
- **A leaner dashboard.** "Start new experiment" is now "Start", and the footer and the top bar's tagline are gone.

Tests: `test/leaf-dependencies.test.js`, `test/worker-ownership.test.js`, `test/stop.test.js`, `test/frontend.test.js` and `test/v711-builder.test.js`.

No live run used v7.13.2 on its own: run6 ran on v7.13.1, and run7 on v7.13.3.

## v7.13.3: the API coverage gate, and the alias on a name collision

Motivated by run6 (9642ff74). Commits c8d7c16, 5e8748a, 87f3628 and e5d7000.

- **The API coverage gate.** Before the runner's test is fixed, the decision model maps each operation the goal names to the one method of `start()`'s API that performs it, or to none (`COVERAGE_SYSTEM`: reading is not creating, and one operation is listed once).
  - The runtime checks the mapping against the API the Container described (`src/api-coverage.js`). An operation has a gap when no method is named, when the name is not a function or class member that `start()` returned, or when an earlier operation already uses that method.
  - A function, class or array that `start()` returned is checked too, and every operation is then a gap: a bare `(data) => …` for a CRUD goal was another route to run6's false completion.
  - Gaps go to the entry worker as an entry problem (`api_incomplete`), naming the missing operations and the methods `start()` did return, and no runner test is written.
  - A complete mapping goes to the runner as `operations_to_test`. The runner must exercise each mapped method, and a draft that never calls one is turned back before it runs.
  - A model error is retried as the linker's and the runner's are. An answer that is no mapping, twice, fails open (`coverage_unchecked`).
  - On the live line this ran in Root's builder. **In v7.14 it runs in the compiler**, and its gaps go to Root as an entry problem. v7.15 adds a fallback from the plan when the model gives no usable mapping.
- **The alias on a collision (c8d7c16).** In run6, the builder's rename `{ loadTickets }` → `{ getTickets }` in a file that declares its own `function getTickets` was rejected three times, because the renamed file no longer parsed. The alias fallback now finds the renamed keys by a token diff inside the one hit, and writes `{ getTickets: loadTickets }`. Every earlier condition still holds: one hit, the same module, and a target that exports the new name and not the old one.
- **Prompt sentences.**
  - `LINKER_SYSTEM`: binding a name to a different operation, such as `createTicket` to `saveTickets`, is a missing function. The model reports it as an issue instead of renaming.
  - The scope check: a module that composes other pieces by importing them, such as an entry module that exports `start()`, is source code, and its scope is judged like any other child's.

Tests: `test/api-coverage.test.js` (new), `test/linker-alias.test.js`, `test/scope.test.js`, `test/boundaries.test.js` and `test/v711-builder.test.js`.

## The export connector

Built on the live line alongside v7.13.3, to get a run's application out of the room. First used live in run7, which downloaded an UNVERIFIED ZIP.

- **`ControlRoom.appFiles()`** is the one place that knows where the application lives. On the live line that was Root's builder's published files. **Since v7.14** it is the top builder's linked modules plus the compiler's loader, `package.json` and the runner's test. For a goal Clef left atomic, it is Root's own files. Assembly metadata and agent notebooks are left out, and a generated `README.md` gives the goal, the run status and how to run the application with plain Node.
- **`passed`** is true only when the files hash to exactly the snapshot of the last passing Container run. Anything changed since then, or no passing run, makes the export **UNVERIFIED**.
- **`GET /api/app`** returns the files as JSON, and **`GET /api/app.zip`** returns a ZIP (`recursive-app-<room8>.zip`, with an `x-app-passed` header). `src/zip.js` is a store-only ZIP writer with no dependencies.
- **`POST /api/export/github`** pushes the application to a new branch of a repository and opens a pull request (`src/github-export.js`).
  - The token is the `GITHUB_TOKEN` secret only. It is never read from a request, never returned or logged, and redacted from every error.
  - Only `https://github.com` and `https://api.github.com` are contacted, without redirects.
  - The base branch is cloned at depth 1 without a checkout. The export directory is replaced by exactly the application's files, and only objects the base lacks are pushed. Nothing is ever force-pushed.
- **The dashboard** gained **Download app (.zip)** and **Push to GitHub**. **Push to GitHub is hidden for now** (3811837), since it is not being tested; the route is unchanged.
- Later fixes: an atomic Root's own code is exported, a `409` says when a room has ended (2569786), and `MemoryFS` lets a checkout set file modes (9258c6d). In the v7.14 layout, a top builder in the middle of a link exports what it last published instead of failing with a `500` (d0584c3), and the README claims a Container run only for files that passed one (c0db3b2).

Tests: `test/zip.test.js`, `test/app-export.test.js`, `test/github-export.test.js` and `test/memory-fs.test.js`.

**What run7 showed on v7.13.3.** Run7 (4203fa2a) did not complete. It ran 38 minutes, with two pauses that needed Continue.
- Its store built its API with an immediately invoked function: `(function(){ … return { createTicket, … }; })()`. The linker read the export as "result of FunctionExpression()", and Root told three workers that the store "exports nothing by name". The workers then rewrote good imports into nonsense.
- The entry bound whole modules as values and returned them from `start()`.
- The runner wrote prose before a code fence that the token cap left open, and its drafts were turned back seven times with "syntax error at 1:5".
- The coverage model never returned usable JSON: four `coverage_unchecked` events.

## v7.13.4: what run7 showed

Motivated by run7 (4203fa2a). Commits 09bb4bd, 9264ac0, 4064df3, 4dc3ff8, 84b4b52 and ca355a5.

- **The export surface of an immediately invoked function.** A function invoked in place whose one top-level return is an object literal now exports that object, with its functions' parameters. `exportNames`, the mismatch check, `autoLink`, the alias and the binding fixes all see the names through it.
- **A fourth binding fix.** A module bound whole that the file never calls or reads, and only passes on as a value (an object property, array element, argument, return value or export), is bound by name when its exports hold that name: `const f = require(p)` with `{ view: f }` becomes `const { f } = require(p)`. This applies only when that member may be the function the binding names, never the module's own data. `LINKER_SYSTEM` names the fourth shape.
- **Model output is read wherever it is.**
  - `stripReasoning` removes closed `<think>` blocks, everything up to an unpaired `</think>`, and an unclosed `<think>` to the end.
  - `extractCode` tries closed fences (JavaScript-tagged first), the text after an unclosed fence, the text from the first line that starts like code, and the whole text. Of those that parse, it prefers one that requires `./index.js` and calls `start()`.
  - JSON answers are read as balanced top-level objects. When a plain parse fails, the fallback takes only an object that ends the text once reasoning is stripped. The coverage answer is the last object holding an operations list; one the token cap cut is no answer, and entries copied from the prompt's example are dropped.
- **`/no_think`.** The runner and coverage calls append `/no_think` on the default Qwen3-30B-A3B model only. The runner's token budget is 4,096, and coverage's is 3,072.
- **Output heads in events.** `runner_rejected` and `coverage_unchecked` events end with the first 200 characters the model returned after its reasoning.
- **One automatic runner retry.** The first time the runner fails three drafts for a source fingerprint, it gets one more round of three drafts, as a counted turn that starts afresh, as Continue does. After that it waits for Continue. In v7.14's layout, the compiler retries.

Tests: `test/run7-linker.test.js` and `test/run7-model-output.test.js` (new), with additions to `test/linker-alias.test.js`, `test/api-coverage.test.js`, `test/app-export.test.js`, `test/boundaries.test.js` and `test/v711-builder.test.js`.

**What run8 showed on v7.13.4.** Run8 (48a10b1d) paused at 9.6 minutes after 5 repair rounds, and needed Continue.
- The v7.13.4 fixes fired live: the alias on a collision, the new whole-module binding fix, and the coverage gate's `api_incomplete`, which caught `start()` returning `{create:{start}, view:{start}, update:fn, delete:{start}}`.
- Root split `data-store` into a sub-manager with three modules: load, save and append. Four consumers did `require('./data-store')` and expected `loadTickets` and `saveTickets` from one module. Renaming cannot do that, and the edits that split the destructure were refused as adding code.
- The entry called `.start()` on every module, and the providers then added `start()` exports to satisfy it.
- The linker bound `addTicket` to `saveTickets`.
- The room paused because the entry worker answered its last repair with "fixed" but wrote no file: nothing changed, and nothing was relinked.

v7.15 fixes these: one import line per function, the reader rule, the rebinding guard, and the no-change repair bounce. See [CHANGELOG-v7.15.md](CHANGELOG-v7.15.md).

## The dashboard after v7.13.0

All of these are in this branch:
- the tyrtop.com palette with automatic dark mode;
- the ownership tree as circles, with the selected agent's details below the tree, not above it;
- a light band that sweeps across a manager's split circle while its builder links the branch (off under `prefers-reduced-motion`);
- the newest agent traffic first;
- no hero heading and no "Invariant" panel;
- Start turns into Stop, with a square where the arrow was, and then into Stopping while the running turns finish;
- **Download app (.zip)**;
- **Push to GitHub**, hidden for now (the `POST /api/export/github` route is still present);
- the default goal is just the product sentence, "Build a small issue tracker that lets someone create, view, update, and delete tickets." The earlier extra sentences (decompose, own your interfaces, use public knowledge, assemble) date from when the goal was the only way to steer the models. The runtime still appends the `start()` requirement.

Asset URLs moved from `?v=7.13.1` to `?v=7.13.9` on the live line. v7.15.0 serves `?v=7.15.0`.

## Container image

`container/` is unchanged since v7.11.

## Tests

At the v7.13.0 merge (e1004c8), 288 local tests passed (`npm test`), up from 242 in v7.12, and `npm run check` covered 51 files.

| File | Tests | What they cover |
|---|---|---|
| `test/prune-on-discovery.test.js` | 13 new | Run 3's root.4 split, a keep, a kill, a Clef error, a late split, the five note fixes, and two guards: Root's split is never walked, and `MOCK_AI` is unaffected |
| `test/linker-alias.test.js` | 8 new | The third binding fix and the import alias, on live fixtures |
| `test/boundaries.test.js` | 8 new | Boundaries, excerpts and the excerpt guard, in rooms run through the real Container runner script |
| `test/decomposition.test.js` | 6 more | Entry marking and the splitter prompt |
| `test/v711-builder.test.js` | 9 more | Entry checks, among them run 3b's sources |
| `test/clef.test.js` | 1 more | With no threshold passed, the Clef gate splits only at p ≥ 0.7 |
| `test/frontend.test.js` | 1 more | The dashboard's threshold control defaults to 70% |

- `scope.test.js` and `spawn-cap.test.js` now count the walk's Clef calls.
- Two split-recovery tests that replay a live Clef YES at p 0.56 now set threshold 0.5.

Each hotfix's tests are listed with it above.

## Still open after v7.13.4

- **Two problems from the v7.13 review**, both fixed in v7.14:
  - **A stuck worker paused the room.** A worker the code gate kept rejecting still paused the whole room until Continue. Run 3's React worker did this. *v7.14 files it as a problem for its manager.*
  - **Root's builder decided alone.** It still decided who changes what for the whole tree. *v7.14 gives that decision to the lowest manager whose branch holds every party.*
- **Four defects the review of the merged v7.13.0 found**, all fixed in v7.14:
  - an excerpt edit was refused because its text also occurred inside a longer token outside the excerpt;
  - `start()` attached after its object was declared was taken as known to be missing;
  - the owner notes were too long for the channels that carry them;
  - with two modules exporting `start()`, a CLI dispatcher was started over the module whose `start()` returns the API.
- **What run8 showed**, fixed in v7.15.
