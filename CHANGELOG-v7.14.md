# v7.14: four roles, and problems solved where they arise

## What changed

Up to v7.13, Root was a special node. Its builder alone did these jobs:
- ran the Container;
- chose the entry;
- had the runner test the application;
- decided which worker anywhere in the tree had to change its code.

The live runs show what that cost:
- **Run 3b (9 flat workers).** Root's builder sent 12 problems, then 1, then 6. It chose who changes by fixed rules, with no way to settle one naming convention across the handlers.
- **Run e89dba35 (four levels deep).** Root sent 12 problems twice, mostly about code inside `root.3`, whose own manager never saw them.
- **Run 3.** A worker the code gate kept rejecting paused the whole room.
- **Run 26fadbdb, the one live run on v7.13.** Clef's scope check rejected Root's proposed entry child (p 0.346), because the goal never mentions an entry. Without that child, no worker carried the `start()` contract.

v7.14 makes every node one of four roles. Root is the final stop on the train, not a special manager. The release follows the design spec and the author's decisions, in two slices:
- **Slice 1:** one builder at every level, the compiler node, and the problem inbox, at parity with v7.13's routing.
- **Slice 2:** the managers' decisions, retire and retask, and workers stuck at the code gate.

Each slice had a review, and the fixes from both reviews are part of the release. Everything below is verified locally, with the real Container runner script run in Node. No live run has used v7.14 yet.

### Four roles

| Role | Node | Does | Never |
|---|---|---|---|
| Worker | a leaf | writes modules, and fixes its own modules when its manager sends it a repair ticket | decides for others |
| Manager (Root included) | a node with children | splits, scope-checks and prunes its children; solves the problems in its inbox: assign, escalate, retire, retask | writes code, or reaches below its direct children |
| Builder | `Temporary builder`, one per manager, a child of that manager | links the manager's direct children, rename-only plus the runtime's binding fixes; publishes a boundary; reports what renaming cannot fix to its manager | decides who changes what |
| Compiler | `Compiler`, one per run, a child of Root | chooses the entry; writes `glue/index.js`, `package.json` and the runner's `glue/smoke.js`; loads and starts the application in the Container; has the runner test it; triages; reports failures to Root | writes or edits application code |

A manager owns only its direct children, and problems move one level at a time:
- A builder reports to its own manager, and the compiler reports to Root.
- A manager either assigns a problem to one of its direct children or escalates it to its parent.
- A problem is solved by the lowest manager whose branch contains every party to it.

The runtime enforces who writes what:
- `putFile` lets the compiler write only `glue/index.js`, `package.json`, `glue/smoke.js` and `compile.manifest.json`.
- A builder writes only renamed copies of its children's modules, `assembly.manifest.json` (with `entry: null`) and `assembly.boundary.json`.
- A manager writes only its knowledge and memory files.

### One builder at every level

- Every builder runs the same turn, at every level, including Root's.
- It waits until every worker under its manager has finished, no repair ticket is still in flight there, and no manager below holds an open problem. Then it links its manager's direct children: a worker child's modules, and a sub-manager's linked bundle read through its boundary.
- It relinks up to `MAX_RELINKS` (2) times while problems remain inside the branch.
- Below the top, it publishes the bundle and the branch's boundary. An import that resolves nowhere in the branch becomes a need on the boundary, for the builder above.
- At the top, the same import becomes a problem for Root.
- A name or binding mismatch between the branch's own modules is a problem for its manager.
- The builder then waits (`builder_waiting`) until the source changes, its manager asks it to relink, or Continue relinks it with a fresh budget.
- Root's builder no longer runs the Container, chooses the entry, asks for an entry, writes the loader or calls the runner. That work moved to the compiler.
- A linker note (an "issue" from the model) rides only with a static problem that names its file. A note about a problem's provider marks that provider as the side to blame (the manager's model decides, M3). With no static problem, a note is only a `link_note` event and reaches no worker.

### The compiler

- Root spawns the compiler once its builder has linked the current source, or earlier for the static entry check below.
- The compiler runs again for a new bundle, and also for new source that links to the same bytes as a bundle that failed. Its request and its report carry the source fingerprint as well as the bundle digest (30ecb18).
- **Entry.** The entry is the one module that exports `start()`.
  - Of several, it is the one whose `start()` returns a value without reading the command line, listening or prompting. Next comes one that returns a value, and last one that returns nothing. A tie goes to the module that imports the most others (2bf75d2).
  - When no module is known to export `start()`, it is the likeliest composing module among those that may export it, and the Container decides.
  - With no candidate, the compiler files "No application entry" without running the Container.
- **Container check.** The compiler writes the runtime loader `glue/index.js` and `package.json`. The Container parses every file, loads the entry and calls `start()`.
  - An entry that only may export `start()` and has none makes the loader throw (`NO_START`), and the compiler files the entry problem. Before, the loader handed out the module's exports as the application, so a run could complete with no `start()` anywhere (2bf75d2).
  - `start()` must return something to call, as in v7.13.
- **Runner.** A separate model call writes `glue/smoke.js` from the goal and the description of the live API alone. The Container runs it.
  - When no stack frame names a module, triage names the module whose worker must change, or says the test is wrong.
  - The test stays in the application.
- **Failures.** Every failure goes to Root as a problem: `entry`, `load` or `run`.
  - The Container reports one error once per module in its stack. That is one problem, whose sites are those modules, and the module that threw first changes.
  - An interface error also names the import it read as the other party.
- **Static entry check.** While Root's builder has problems reported, the compiler checks the entry of the published bundle without the Container, in Root's turn before Root decides. A missing `start()` then joins the link problems' wave, so a worker hears both in one ticket and one repair round.
- **Waiting.** An infrastructure failure blames nobody: the compiler waits (`build_blocked`), and Continue retries it. A runner that cannot write a valid test in three attempts also blames nobody (`runner_failed`), and Continue retries.
- **Completion.** The room completes only when the compiler has passed on the bundle linked from the current source.
- **Requests (30ecb18).** A compiler that waited for the top builder has its request cleared, so Root requests it again. Continue wakes a waiting compiler whenever the top builder is current and the compile has not passed.

### Root is the final stop

- Root splits exactly like every manager.
  - The splitter prompt is the same at every level, and an `"entry"` mark is dropped wherever it appears.
  - Nothing is appended to a chosen child's task.
  - `entry_child` and `entrySpec` are gone, along with the model's entry proposals.
- When a run starts, the runtime appends this requirement to the goal:
  > Requirement: the application exports start() from one entry module; start() returns an object whose methods perform the operations this goal requests, and importing a module does no work at load (no reading process.argv, starting a server or prompting).
- Clef's scope check reads every child against the goal, so it now sees this requirement. The splitters assign it like any other requirement, at whatever level.
- The compiler enforces the requirement. A missing entry, an entry without `start()`, or a `start()` that returns nothing to call is an `entry` problem filed with Root.
  - Root places it like any problem, by default with the module most likely to compose the application, among the modules nothing imports and by file name.
  - The manager whose branch holds that module passes it down.
  - Its worker's ticket leads with `ENTRY_CONTRACT`.
- Root differs from other managers by position only:
  - It has no parent. Its own split is not walked by the prune walk, and an import that resolves nowhere becomes a problem rather than a boundary need. Where another manager would escalate, Root closes the problem, and when its repair rounds run out, the run fails.
  - The compiler hangs under it.
- Root-keyed build state is gone.
  - Every manager has the same keys: `linked:`, `link_state:`, `link_reported:`, `bundle:`, `repair_rounds:`.
  - The compiler has `compile_*` keys.
  - The `MOCK_AI` legacy path is unchanged.
- A room started before v7.14 is reset, not migrated. Continue refuses it with "This room was started by a version before v7.14 and is not migrated", and Start resets it.

### The problem inbox

- Problems are rows in a table in the room's SQLite, each held by one manager.
- **Kinds:** `unresolved`, `mismatch`, `binding`, `entry`, `load`, `run` and `stuck`.
- **Parties.** Each problem has parties: reader, provider, site or subject. Each party has its owner, the worker found by following provenance through every builder.
- **Reports.** A builder or the compiler files a report in one synchronous block:
  - its earlier rows close as `superseded`;
  - the new rows open in its manager's inbox as one report wave, at most 12;
  - the reporter waits, and the manager wakes.
- **Placement.** The manager places each party under one of its direct children, outside its branch, or nowhere known. It is the lowest common manager when the parties fall under two or more children, or under one child that is a worker.
- **Movement.** An assignment goes to a direct child: a worker, a sub-manager or the builder.
  - A decision for a sub-manager travels as a side ("the reader changes"), never as a node below it, and the sub-manager places that side among its own children (relay).
  - A sub-manager that gets a problem with no decision decides it (delegate).
  - Escalation goes to the parent.
- **Tickets.** A worker gets one `[build:repair]` ticket per turn, holding all of its problems:
  - who decided;
  - what to do, with `ENTRY_CONTRACT` first for an entry problem;
  - what the other side provides, one line per module;
  - every problem, in the worker's own file paths.
  - The ticket is at most 2,400 characters. A ticket whose problems all closed since it was sent reads as withdrawn.
- **Compare-and-set.** A row moves only if it is still as it was read. A stale decision is logged (`problem_decision_stale`) and sends no ticket.
- **Replaced machinery.** The inbox replaces `build_failure:root`, `routeBuildFailures` and `forwardBuildRepair`.

### Deterministic rules first

A manager decides each problem by these rules, first match wins:

| Rule | When | Decision |
|---|---|---|
| hops | the problem has had `2 × depth + 2` decisions | closed, exhausted |
| rounds | a child manager has run out of repair rounds | that child fails, unless the model retasks or retires it (M5) |
| D8 | a worker child is stuck at the code gate for TypeScript, JSX, React, non-code output or a package import | retasked once, its task gaining "Write plain JavaScript (.js) with Node built-ins only: no TypeScript, JSX, React or packages." |
| stuck | any other stuck child | the model's (M5). By default it goes up as this manager's own problem ("its branch cannot finish"), and at the top it closes |
| D1 relay | the parent decided which side changes | the child holding that side gets it |
| D2 outside | a party lies outside this branch, and nobody above decided | escalate |
| D7 | no party lies under this manager | escalate; at the top, the model's (M7), and closed by default |
| D5 relink | a load or run interface error where this manager is the lowest common one, or one this manager's builder's own edit caused | its builder relinks: once per error and source, while relinks are left, and once per builder |
| D3 delegate | every party lies in one sub-manager's branch | that sub-manager decides |
| D4 | every party lies in one worker | that worker |
| D6 | a two-sided mismatch | the reader changes. A problem a child escalated, which exactly one other child can satisfy, goes back with that child's exports (M6 settled) |

- **Who caused an error (b5c28f7).** A builder's edit counts as the cause only when a name or path it put into the failing line appears in the error's message. When the error names no line of the file, any line counts. Before, a top builder that renamed an unrelated import path in the file relinked a branch's own bug first, and the shared `builder_tried` flag then kept that branch's builder from relinking it. `builder_tried` now lists the builders that tried.
- **Validation.** Every decision is checked:
  - the child must be a direct child that can take it;
  - never the compiler;
  - the builder only for an interface error with relinks left.
- A refused decision escalates, or at the top closes.

### The manager's model, only for a real choice

- The model is asked only when the rules leave a real choice:

  | Trigger | When |
  |---|---|
  | M1 | nobody wrote what the reader calls |
  | M2 | several children agree on names the provider lacks |
  | M3 | a builder note blames the provider |
  | M4 | the same child had the problem twice, or returned its files unchanged twice |
  | M5 | a stuck child that D8 does not settle |
  | M6 | a child escalated the problem |
  | M7 | no party lies under this manager |
  | M8 | two children disagree and neither side is anchored |

- **Clusters.** Problems needing the model that share a party child form a cluster.
  - A problem the rules assigned to one of that cluster's children joins it as "proposed", and the model may change it.
  - A decision that reaches a cluster child only as the provider is fixed, and the model must keep it.
  - Delegations, relays and relinks are never proposed.
- **One call per turn.** A manager makes at most one model call per turn, on the largest cluster of at most 12 problems.
  - Another cluster waits for the manager's next turn, which it starts itself while its model may still be asked.
  - The decisions the rules made outside the cluster are applied before the call, and the model's after it. Each is one synchronous block.
  - A Durable Object restart while the model answers keeps the tickets already sent and decides the cluster again.
- **What the model reads:**
  - the manager's responsibility;
  - its direct children: a worker by its modules' exports, a sub-manager by its boundary, the builder by its relinks left, each with its history;
  - the problems, with their parties as child, file and role, the builder's evidence and the default the rules would apply;
  - the decisions it must keep;
  - the rounds left.
  - Child ids in its instructions become labels for the recipient. An id the recipient may not see voids the instructions, and the default text is used.
- **Actions.** The model may assign, escalate, retask or retire. Each action is validated:
  - **assign:** instructions of at most 900 characters, and facts from direct children that write code.
  - **retask:** a task of 8 to 1,700 characters that Clef scores at p ≥ 0.5 against the goal and this manager's responsibility.
  - **retire:** refused for the last child that writes code, for a child that a module outside its branch imports, for the child whose code exports `start()`, for a branch with a turn running, and for the compiler.
  - The first valid action covering a problem decides it. Everything the model leaves out keeps its default.
- **Limits.**
  - Each manager has at most `MAX_MANAGER_MODEL_CALLS` (8) calls per run, a retry after unparsable output counting as one.
  - `decideProblems` never throws. An AI error, or a second unparsable answer, applies the defaults.
  - A model call costs one unit of the turn budget. Once the budget is spent, managers still run, but they use their defaults.
  - With no model, out of calls, out of budget or out of rounds, every decision is the rules' alone.
- **Compare-and-set.** A retask or retire stands only on rows that are still as they were read (a612858).

### Retire and retask

- **Retire.** A retired child takes its whole branch with it: queued turns, undelivered messages, routes, aliases at every level above, and open problems. Its code leaves the bundle that the level above reads, and its manager's builder relinks what remains.
- **Retask a worker.** The worker gets the new task and runs again. A problem the retask settles stays assigned to it, so a rerun that changes nothing reopens it.
- **Retask a sub-manager (author decision 1).** This kills its branch:
  - every descendant is retired, its builder included, and the problems the sub-manager held close;
  - it splits again as a new child, through the split gate and the prune walk;
  - its next builder is a new generation (`builder:<id>:<gen>`).
- Retired nodes take no agent slot.

### Workers stuck at the code gate

**Live evidence, run 3.**
- The React "TicketForm Component" worker (root.3.3.3.4.1) failed the parse gate three times, and the room paused at 126 seconds.
- Run 3's code gate also rejected `express` and `pg` imports.

**Fix.**
- Each failure is recorded as either the code gate's or the infrastructure's:
  - **code gate:** missing code, a non-code or unparsable file, a rejected split, or a bad action;
  - **infrastructure:** an Artifacts commit or a network error.
- When a worker below the top fails three turns in a row, all at the code gate, a `stuck` problem with its last failures goes to its manager, once while it is open. The room does not pause.
- Infrastructure failures still pause for Continue. A clean turn, or Continue, resolves the stuck problem.
- A stuck worker that its manager tells what to write starts a fresh turn with the ticket, and its count starts again (a612858). A worker told twice is not told a third time.
- A stuck branch is never assigned back to its own sub-manager. It is retasked, retired or escalated.

### Repairs are bounded

| Limit | Value |
|---|---|
| Relinks per manager per source (`MAX_RELINKS`) | 2 |
| Repair rounds per manager (`MANAGER_MAX_ROUNDS`) | 6 |
| Repair rounds per run | 8 + 2 per manager, at most 40 |
| Decisions on one problem (`MAX_HOPS`) | 2 × depth + 2 |
| Unchanged repairs before the model or a close (`STUCK_AFTER`) | 2 |
| Model calls per manager (`MAX_MANAGER_MODEL_CALLS`) | 8 |
| Problems per report, and per model call | 12 |

- **Rounds.** A manager spends a round when it first assigns a report wave to a worker or to its builder, and when it retasks.
- **Out of rounds.** The top fails. A lower manager tells its parent once that it cannot finish its branch, and the parent fails it unless its model retasks or retires it.
- **Unchanged repairs (6c07847).**
  - A repair that changes nothing reopens its problem once.
  - The second unchanged repair closes it, or, while the model may be asked, leaves it to the model (M4), which closes it by default.
  - Before this fix, the same rule sent the same ticket again until the hop limit. In the slice 1 review's e89dba35 replay that cost 25 worker calls, and each Continue added 10.
- **A problem closed without a fix (6c07847).** Its reporter could be left waiting, and the room paused with no failure. Now, when nothing of the report is open and nothing below could still change the source, Root fails the run, and a lower manager tells its parent it cannot finish.

### v7.13 fixes folded in

A review of v7.13 found four defects, all fixed here:
- **(a) Excerpt edits (295791b).**
  - The excerpt guard now counts only what an edit would replace outside the excerpt: whole tokens, and a bare path widened to its specifier.
  - Before, `save` was refused because `autosaveEnabled` held it, or `./ticketStore` because `./ticketStoreFormat` did.
  - In the review's E2 room, v7.13 refused the `save` rename at every relink and blamed the worker. v7.14 completes with 2 linker calls and 1 runner call.
- **(b) `start()` attached after the declaration (22d16f7).** The forms are `const app = {}; app.start = …` and `class App {}; App.start = …`. Such a module is no longer "known to lack `start()`", so the Container decides and no correct worker is blamed.
- **(c) Short owner notes (41a6f8c).**
  - A pruned child's note in memory is now short: the owner and the label, "import it from that strand and write here only what it lacks". Only the split feedback quotes the pruned piece.
  - Memory lists the newest notes first.
  - On run 3's root.4 split, v7.13's four notes took 1,097 characters, and the fourth fell past the 750-character channel. v7.14's take 468, and all four reach the child.
- **(d) Two modules exporting `start()`.** The module whose `start()` returns the API is started, not a CLI dispatcher that imports more (2bf75d2).

### Fixes from the reviews of v7.14

**Slice 1 review:**
- the edit cause and per-builder `builder_tried` (b5c28f7);
- `NO_START` and the starter ranking (2bf75d2);
- the two compiler stalls (30ecb18);
- the unchanged-repair loop and the waiting reporter (6c07847).

Four smaller fixes (b507b0d):
- **Import offers.** An import that resolves nowhere at the top is offered the module named like it first, then modules exporting the names it reads, nearest first, never one that imports the reader.
- **Relayed decisions.** A relayed decision stays the parent's, so a reopened problem is relayed again, not escalated.
- **Problem signatures.** They drop the Container's build folder and line positions, so a recurring load or run error is recognized as the same problem.
- **The entry contract.** It appears in a ticket once.

**Slice 2 review (a612858):**
- stuck tickets reach the worker on a fresh turn;
- a stuck branch is not assigned back to itself, which had made it bounce until the hop limit;
- a stuck problem closed above pauses its worker with a `paused` event;
- retask and retire use compare-and-set;
- with the model failing, deferred clusters keep their defaults in the same turn;
- an entry ticket keeps `ENTRY_CONTRACT` first;
- a decision's facts add to the problem's own;
- the facts from a listed branch name the modules its problems point at;
- the model sees each child's history, and an assign of what a child returned unchanged twice is refused;
- a worker retask keeps its problems assigned;
- retire and retask drop aliases at every level;
- a retasked sub-manager's own problems close with its branch.

### Replays

These replays run the real scheduler and the real Container runner script in Node, with scripted models. Each compares v7.13 (e1004c8) with this release, on the same inputs and the same scripted workers.

**Run 3b at step 49: the live final worker files, in which `app.js` exports nothing.** Live v7.12 made 1 Container run and 3 runner calls, then ended in `runner_failed` with no worker blamed.

| Version | Before the repair | After root.9 writes `start()` |
|---|---|---|
| v7.13, with root.9 recorded as the entry child | No linker call; the contract goes to root.9 | — |
| v7.14 | Root's builder links with no linker call. The compiler files "No application entry" without the Container, and Root assigns it to root.9 (D4): one round, one ticket | The run completes: 2 Container runs, 1 runner call |

**Run 3b round 1: the live first-round files.** The replay uses a linker that fixes paths only, and run 3b's three live builder notes. The workers follow their tickets the way the live Qwen workers did: a handler told "caller expects X" renames its export to X.

| | v7.13 | v7.14 |
|---|---|---|
| Result | complete | complete |
| Worker turns | 6 (root.8 twice, from the oscillation between the handlers and the dispatcher) | 5 |
| Linker calls | 6 | 3 |
| Container runs | 2 | 2 |
| Runner calls | 1 | 1 |
| Repair rounds | 2 | 1 |
| Manager model calls | none | 1 |

- In v7.14, Root's one model call decides 10 problems (M3, M8 and proposed) as one convention.
- Tickets go to root.4, root.5, root.7, root.8 and root.9. Nothing goes to root.2, root.3 or root.6.
- The counts are the same with a model that answers `{"actions":[]}`, one that puts every problem in one assign (refused, so the defaults apply), and one that picks the dispatcher's convention (then root.6 changes instead of root.8).
- A model that returns no JSON costs 2 calls, the retry counted, and gives the same result.

**Run e89dba35's deep tree: the live final files, a path linker, and root.6 and root.3.2.1 repairing.**
- Both versions complete with 2 worker turns, 8 linker calls, 2 Container runs and 1 runner call.
- In v7.14, Root makes the only model call (M8, `ticket.js` against `ticketStore.js`). The decision is relayed one level at a time, root → root.3 → root.3.2 → root.3.2.1, by D1 at each level.
- The entry problem goes to root.6 by D4.

**The same tree, with workers that return their files unchanged.**
- v7.13 pauses after 2 worker turns, and each Continue repeats them.
- v7.14 gives each worker its ticket twice (4 worker turns). It closes the problems as exhausted and fails the run with "Repair exhausted", instead of pausing. Its managers make 3 model calls.

**A runtime error inside one branch whose provider is in another (review E1).**
- The stack names modules in two of Root's children, so Root is the lowest common manager, and Root's builder relinks the call (D5).
- Both versions: 2 linker calls, 2 runner calls, 4 Container runs.

**Run 3's React worker, which writes JSX, and a worker that imports `express`.**
- v7.13 pauses after three failed turns.
- In v7.14, D8 retasks the worker to plain JavaScript with no model call. Its fourth turn passes, and the run completes.

## Container image

`container/` is unchanged since v7.11.

## Tests

350 local tests pass (`npm test`), up from 288 in v7.13. `npm run check` covers 56 files.

| File | Tests | What they cover |
|---|---|---|
| `test/problems-unit.test.js` | 20 new | Placement and the lowest common manager, D1–D8, the hop and round limits, the deterministic validator, signatures, instructions, the repair text, model triggers, clusters and the validator of the model's actions |
| `test/v714-problems.test.js` | 18 new | Rooms: a sibling mismatch solved by the branch manager without Root; a cross-branch need decided at the lowest common manager and relayed down; a compiler failure routed one level per decision; branch builders that link, relink and report as the top builder does; a compiler that never edits a module and blames nobody for infrastructure; critique #23 and its edit-cause rule; one problem per stack; the round limits; unchanged repairs; compare-and-set; the two compiler stalls; rooms from before v7.14 |
| `test/v714-decisions.test.js` | 24 new | Run 3b's convention settled by one model call, and the same assignments with no valid JSON; a sub-manager retask that kills its branch and splits again with a new builder generation; an escalated problem sent back with the one provider's facts; restarts while the model decides; stale retasks; a throwing model; retire guards; call and budget limits; stuck workers retasked (D8, run 3's React worker), retired, assigned or escalated |
| `test/helpers/room.js` | — | Shared room fixtures for these tests, with the real Container runner script |
| `test/boundaries.test.js` | 1 more | The v7.13 fix (a) |
| `test/prune-on-discovery.test.js` | 1 more | The v7.13 fix (c) |
| `test/v711-builder.test.js` | 1 more | Rewritten to run through the compiler and the inbox; new: an entry that only may export `start()`, two starters, the import offers, a ticket that names each module once |
| `test/decomposition.test.js` | 3 fewer | The entry-marking tests, replaced by one asserting that Root splits like every manager |

- **Rewritten tests.** Tests that asserted Root-centred building now run through the compiler and the inbox: `build_failure:root`, `routeBuildFailures`, `run_passed:root` and Root entry marking.
- **Deleted tests.** Six tests were deleted with the machinery they covered: `entrySpec`, the entry mark and `entry_child`, and the model's entry proposals. Two of them are merged into one test asserting the opposite: a mark is dropped at every level.
- **Unchanged.** The `MOCK_AI` suites and `public/` are unchanged by v7.14. This branch also merges the v7.13 dashboard palette commit.

## Still open

- **Not verified live.** No live run has used v7.14. The replays above use scripted models.
- **Live run 26fadbdb showed three problems that v7.14 does not fix:**
  - the runner writes a new test every time the compiler runs, so a worker can chase a moving target;
  - a split whose children are placeholders ("Piece A" to "Piece E") reaches Clef and the prune walk, which in that run killed four of the five;
  - a `start()` that returns a single generic handler passes the check before the runner.
- **Long goals are cut.** The goal is clipped to 1,746 characters before the `start()` requirement is appended. The API accepts goals of up to 1,800 characters, so the end of a longer goal is lost.
- **Clef can still reject the composing child.** Its scope check can still reject the child that would compose the application. The compiler then files the entry problem with Root, which places it with the module most likely to compose. Whether that settles faster in a live run than v7.13's marking is not yet measured.
- **Workers that never change their files.** The run ends in failure after each was told twice. That bounds the cost but does not route the problem elsewhere unless the manager's model chooses to.
- **An adversarial retask loop.** A manager's model that keeps retasking a worker that never succeeds is bounded only by that manager's six repair rounds. The branch's problem then goes up to its parent.
- **A Root that does not split.** A Root that Clef does not split writes the application itself. It keeps its own build path, with no builder and no compiler. Its code goes through the Container's build check, and the runner writes no test for it (author decision 4, critique #27).
- **Carried over from v7.12:**
  - The rename check does not compare line breaks.
  - A model path edit that resolves to the wrong module is kept.
  - The undo of a breaking rename sees only what the static name check sees.
  - The check for a member reached by key does not follow arrays or callbacks.
  - Linker input at one level is not split when it exceeds the model's context.
  - `MOCK_AI=true` still uses the older builder path.
