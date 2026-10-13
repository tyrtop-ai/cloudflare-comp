# v7.13: fixes from the live v7.12 runs

## What changed

Two live v7.12 runs on a real Cloudflare account (Qwen3-30B-A3B and Clef-flash, issue-tracker goal) stopped short of a passing application. Both runs used the same goal.

- **Run 3**, at split threshold 0.5, grew to 70 agents: 63 workers and managers and 7 builders.
  - Seven splits were blocked for capacity.
  - Subtrees rebuilt what other strands owned.
  - A React worker failed to parse three times and paused the room at 126 seconds.
- **Run 3b**, at threshold 0.7, split into 9 flat workers.
  - Root's builder sent 12 problems back to workers, then 1, then 6.
  - Its final link at step 49 started an entry module that exported nothing: `start()` returned `{"type":"object","members":{}}`.
  - The runner failed three times, the room paused, and no worker was told why.

v7.13 answers both runs. It was built as four branches on v7.12:

| Branch | What it adds |
|---|---|
| prune | Prune on discovery |
| entry-splitter | The entry contract, the 0.7 threshold and the plain-Node splitter |
| linker-alias | A third binding fix and the import alias |
| boundaries | Builders that link against their children's boundaries |

Each branch had a review, and each review led to a fix commit. The dashboard became an ownership tree of circles in the tyrtop.com palette.

v7.14 builds on this release and changes three parts of it:
- It removes the entry marking. The `start()` requirement moves into the goal, and the entry checks move into the compiler.
- It shortens the prune notes.
- It fixes three defects that a review of v7.13 found.

See [CHANGELOG-v7.14.md](CHANGELOG-v7.14.md). Each such point is marked below.

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

v7.14 shortens the notes kept in memory (41a6f8c).

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
- Exports set by a call, a spread, a re-export or an imported instance may hold `start()`. Those modules go to the Container, which decides (84f4ff9).
- After the Container starts the application, `start()` must have returned something to call: a function or class, or an object or array holding one at any depth. Otherwise the problem goes to the entry worker, and the runner is not asked.
- Root's splitter marked one entry child with `"entry":true`. The runtime appended `ENTRY_CONTRACT` to that child's task and recorded it as `entry_child`, so entry problems went to its module first. When no child or several children were marked, `entrySpec` chose one by its label and task.
- **v7.14 removes this marking.** See "Root is the final stop" in [CHANGELOG-v7.14.md](CHANGELOG-v7.14.md).

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
- Asset URLs are `?v=7.13.1`.

## Container image

`container/` is unchanged since v7.11.

## Tests

288 local tests pass (`npm test`), up from 242 in v7.12. `npm run check` covers 51 files.

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

## Still open

Live Cloudflare deployment of v7.13 is not verified. One live run used v7.13 (room 26fadbdb, threshold 0.7). Its export was taken while the run was still going, at 325 seconds. By then:
- Root's builder had sent problems back six times;
- the Container had started the application five times;
- the runner's test had failed five times.

The run had not completed. It showed these problems:
- **Clef rejected the entry child.** Clef's scope check rejected Root's proposed "Entry point module" child at p 0.346, because the goal never mentions an entry. No child got the contract. The entry fell to `createTicketHandler.js`, whose `start()` returned a lone `handler(event)`. *v7.14 drops the entry marking and puts the requirement in the goal.*
- **The runner wrote a new test for every repair round.** The worker chased a moving target. *Still open in v7.14.*
- **The prune walk killed placeholder pieces.** Root.2's split came back as "Piece A" to "Piece E". The prune walk could place only one of them and killed the other four. *Still open in v7.14.*
- **A lone handler passed the check before the runner.** `start()` returning a single generic handler counts as something to call. *Still open in v7.14.*

A review of the merged release found four more defects. v7.14 fixes all four:
- an excerpt edit was refused because its text also occurred inside a longer token outside the excerpt;
- `start()` attached after its object was declared was taken as known to be missing;
- the owner notes were too long for the channels that carry them;
- with two modules exporting `start()`, a CLI dispatcher was started over the module whose `start()` returns the API.

Two more problems remained:
- **A stuck worker paused the room.** A worker the code gate kept rejecting still paused the whole room until Continue. Run 3's React worker did this. *v7.14 files it as a problem for its manager.*
- **Root's builder decided alone.** It still decided who changes what for the whole tree. *v7.14 gives that decision to the lowest manager whose branch holds every party.*
