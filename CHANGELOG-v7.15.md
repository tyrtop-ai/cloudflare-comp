# v7.15: predicted interfaces

## What changed

Up to v7.14 a split gave each child only a statement of work: a label and a task. Each worker guessed the names of the functions other pieces would export, and the builders renamed what they could. The live runs show what the guessing cost:
- **Run6 (9642ff74).** Clef rejected Root's entry-module child at p 0.448. The create worker copied the prompt's example line `const { createTicket } = require('./ticketStore')` and imported its own function. The linker then bound `createTicket` to `saveTickets`.
- **Run8 (48a10b1d).** Four readers took `loadTickets` and `saveTickets` from one `require('./data-store')` line, though a sub-manager had written them in two modules. The entry called `.start()` on every module, and the providers added `start()` exports to satisfy it.

The author asked for two things:
- a split promises each child's interfaces with its statement of work, Clef checks them in the same step as the statements of work, and they are written down for routing;
- a worker asks its manager for every function it needs.

v7.15 does both. In one sentence: **a split promises a few functions per child, Clef vets them in the same step, the promises are recorded and route, a worker sees only its own promised functions and asks its manager for every function it needs, and a manager answers from its direct children's promises only, one level at a time.**

The design spec's binding decisions:
- **Decision 1.** The runtime writes Root's promise (`start`) when a run starts. A task that says it "exports NAME(" carries NAME. A carrier's task gets its parent's one-line description of each name it carries. All three apply to every name at every level.
- **Decision 2.** A worker's task lists only its own promised functions. It asks its manager for everything else. The manager answers from its own children's promises, by name first and then with Clef, and escalates one level at a time up to Root. Nobody gets a global list of functions.
- **Lead decision.** A manager answers only from its direct children's promises, never from names that a split further down a child's branch added.

It was built on v7.14 in three slices, each with a review and review fixes:
- **Slice A, names in the plan:** the splitter's promises, the checks and repairs, Clef's vetting, the records, the walk by name, the worker's contract and the return check.
- **Slice B, workers ask:** function requests, answered one level at a time.
- **Slice C, names link and compile:** the linker, the builders and the compiler read the plan. This slice also carries three fixes from run8: one import line per function, the reader rule and the no-change repair bounce.

Each slice also composes with v7.14's manager decisions (retire and retask). Everything below is verified locally, with the real Container runner script run in Node. **No live run has used v7.15.**

### The splitter promises

- For each child, the splitter returns its statement of work and `functions`: the few functions (at most five) that code outside the piece calls. Each is `{"name", "does", "params"?, "operation"?}`.
  - Names are binding: the piece exports exactly these names, and other pieces import them by these names.
  - `does` and `params` are hints. A piece may export more.
  - `operation` tags a function that performs one of the goal's operations ("create a ticket").
- The prompt asks for names that say what a function does and what it acts on (`createTicket`, not `create`). It also says that a piece needing a function from elsewhere asks for it when it runs, so no piece is created for it.
- `normalizeAction` stores the list as the child's `interfaces`. It still drops `entry:true`, and it drops module paths.
- **Root's promise is the only one the runtime writes**, in live rooms when a run starts:
  > start(): no arguments; returns an object with one method per goal operation, each the function that performs it, which you ask your manager for and import by its name
  
  Root itself reads `start` without the clause about asking a manager, since it has none.
- **A splitter sees its own promise only.** Its request carries `your_promised_functions`: the functions its parent promised on its behalf. It must give each of them, with its name unchanged, to exactly one piece. It never sees another node's functions. The request is built field by field under 8,500 characters, and only the rejection feedback is clipped.

### The checks and repairs, before any child exists

The runtime checks a split's names before Clef is asked, in `src/interfaces.js`.

| Check | When it fails | What happens |
|---|---|---|
| C0 | — | A piece whose own text says it exports a promised name ("exports NAME(", "exporting the function NAME(") carries it. A mere mention does not count |
| C1 | A name is not a plain JavaScript identifier, or is reserved | One retry in the same call; then R1 deletes the name |
| C2 | A name is copied from the prompt's example (`functionName`, `camelCaseIdentifier`, `listedName`, …) | One retry; then R2 deletes it |
| C4 | One new name is listed by two pieces | One retry; then R3 deletes it from both, unless another branch already promises it (then the walk decides) |
| C3 | A piece lists more than five names | One retry; then R4 keeps the promised names and the first new ones, up to five |
| C5 | A name the parent promised is not on exactly one piece | One retry; then the split is rejected |

- C1, C2 and C4 check only the names a split adds: its own promised names were checked when they were promised, and Root's `start` is the runtime's.
- The retry is one more call in the same turn, quoting the failed checks (and placeholder labels, as since v7.13.1). The retry replaces the first answer only when it is not worse.
- A repair deletes a name, never a piece. Promised names are never deleted.
- **Only C5 rejects a split.** The partition was acceptable, so the next turn keeps Clef's YES and does not ask the split gate again: asking again invites "implement it directly", which at Root would hand the whole application to one worker. The splitter gets its proposed partition back, with "only its function names failed".
  - Below the top, after a second names-only failure, Clef is asked again with the feedback, so a branch can write its promise itself.
  - On the last attempt before the node stops (R6), a promised name on several pieces stays on the one whose task says it exports it, else the one whose text mentions it. One on no piece goes to the one piece listing it in another letter case, else the one whose text mentions it. A wrong guess costs at most three contract returns, which is cheaper than a stopped node.
- A worker's late split (pieces it proposes itself) passes the same admission. A late split rejected on C5 leaves the worker a private note saying why.

### Clef vets the names in the same step

- Two Clef calls run in parallel:
  - **`scopeChildren`**, byte for byte as before, scores each child against the goal and its parent's assignment, and drops a child below 0.5. Adding names to its state would have moved every score, and run6's sat near 0.5.
  - **`scopeInterfaces`** asks, for each name a child adds, whether that child's own responsibility writes it, rather than another child's or code outside the parent's assignment. Every child is in its state, and there is one question per name, in batches of 12. **A NO deletes that name only** (`interfaces_stripped`), and the child is kept.
- Promised names are never put to Clef, so no answer about names can reject a split.
- **A child that carries a name its parent promised is in scope by construction** (`scope_allowed` names what it carries). Run6's entry module at p 0.448 is admitted. It also takes its parent's item for that name, so the one-line description travels down unchanged.

### The walk by name

- For each admitted child, the runtime walks up from the splitting node. At each level it compares the child's new names with the promises of that level's other direct children, which is the same rule requests use.
  - A child that carries none of its parent's names and whose new names all belong to one other branch is pruned to it, with no Clef call (`scope_pruned`: "Import them by those names").
  - Otherwise those names are deleted from the child (R5, `interfaces_owned_elsewhere`), carriers included.
  - Generic names (`create`, `get`, `list`, `load`, `save` and the like) are binding but never prune.
- Then the Clef walk of v7.13 runs, for the children that carry none of their parent's names. A carrier never takes it: its names were given to it.
- The run5 replay uses run5's Root children as its tree. Under "Create ticket logic", a proposed "Entry module" and "Entry point" both list `start`, which Root's "Application entry point" child carries. The first keeps `createTicket`, which its branch promised, and loses `start`. The second, made only of `start`, is pruned by name.

### The promise is recorded

- `agents.interfaces` (SQLite) holds each node's promise, and it is what routing reads. A room from v7.14 gets `'[]'`: no promise, and exactly v7.14 behavior.
- `memory/private/ownership.json` in each manager's Artifacts repository mirrors its own promise and its children's, in the same turn as the spawn.
- The snapshot carries each agent's `interfaces`, which the dashboard shows.

### A worker sees only its own promise

- A worker's task, as its model reads it, ends with its contract: each function it must export, by exactly that name, as a named export or a member of the exported object (not as a method of a class or instance), with its `params`, its one-line description and its operation tag. The contract is clipped to 900 characters by dropping the params first, then cutting each description to 80 characters. Names and operation tags are never cut.
- It lists nothing about any other piece: no sibling, no other strand, no label or id. The stored task never changes.
- The turn on which Clef says NO is an isolated worker's turn, like every later one: its own contract, its parent only as "Manager", and no sibling or neighbour memory. Before v7.15, that first turn kept the splitter's view: its parent, every sibling's label and task, and the neighbours' public memory.
- `LEAF_DEPENDENCY_RULE`'s example no longer names `createTicket` from `'./ticketStore'`, the line run6's create worker copied. The example names are neutral (`listedName`, `otherName`), and C2 catches a copied one.

### Workers ask their manager

In a room whose Root promises `start` (every live room started on v7.15), a worker with a manager is told:
- In its first answer, ask its manager for every function its assignment does not list, all at once: `"ask":[{"need":"what the function does, in one line","name":"the name you expect"}]` with `"wait":true`.
- In that answer, write only files that do not import what it asked for, and do not finish.
- At most 8 requests travel in one answer; ask for the rest once they are answered.
- Import each answer by exactly its name, on its own line, with the name as the path.
- Every answer is final and stays in `answered_requests`.

The runtime holds it to that:
- **It waits.** A worker that asks waits, whatever the model said, and a finish with asks and no files counts no failure.
- **A file that imports an asked name waits for the answer** (`import_deferred`). The next turn's view names the file (`last_turn_notes`). A name its current repair ticket gives is never deferred.
- **It cannot finish with a request open** (`done_deferred`). Only its last outstanding answer wakes it.
- **An answer is final.** An ask for a function already answered sends nothing and holds nothing back (`ask_repeated`).
- **Asking for its own promised function** is answered at once, with no hop: write it and export it by exactly that name (`route_own`). Run6's create worker is this case.
- **A worker never waits for nothing.** A worker told to wait with no request open runs again (`ask_unheard`), told why; the third such turn in a row stops it, and its manager hears it as stuck. Asks in the splitter's shape (`{name, does}`, `{function, description}`, a bare name) are read as requests. Asks beyond 8 are named back to it (`ask_clipped`). Continue wakes a planned worker that waits with no request, no unread message and no source.
- **The top has no manager.** It reads "You have no manager to ask: write every function your code needs yourself", and an ask it sends anyway is dropped (`ask_dropped`). A splitting node does not ask; its pieces will.

### Managers answer, one level at a time

- A function request travels as a `[route:request]` with the need and the expected name, and it reuses v7.14's hops.
- **At each level, the manager answers from its direct children's promises only**, minus the branch the request came from:
  1. **The expected name, with no model call**, when exactly one child's promise holds it. A generic name is never matched this way, and neither are other names the need mentions as context.
  2. **Otherwise one Clef call** (`matchFunction`) over those children's functions, `name(params): does`, one question per function in batches of 12. The best answer at or above 0.6 wins. The call is retried once, and a second error counts as no match here.
- **A hit replies `provided`** with the function's name, params, description and the label of the piece that exports it, and with how to import it:
  > Import loadTickets on its own line, by exactly this name, with the name as the path: const { loadTickets } = require('./loadTickets'); the builder links the line to the module that exports it. Do not write it yourself.
- **A miss goes to the parent** (`route_up`), one level at a time. At the top, a miss is `unowned`.
- The answer comes back down the same hops. At the worker's own manager, an `unowned` answer is put to Clef (`ownsNeed`): is writing this function part of the worker's assignment?
  - Yes: the worker writes it in its own module.
  - No: the worker imports it by the name it expects, on its own line, and finishes its code. The missing function reaches Root as a problem when the application is linked.
  - A Clef error counts as yes.
- **What is never done:**
  - A function request is never parked and never answered `out_of_scope`, which fails a worker.
  - Answers are never cached as public knowledge, so an answer from the plan never shadows published source.
  - A worker keeps at most 8 answers, one per topic.
- **A crash between sending a request up and recording the hop** leaves a hop with no target. The manager's next turn sends it again, and the parent drops the copy. Continue wakes every manager that holds one.
- **A retask voids the retasked child's requests** and those of its killed branch. A reply still on its way is dropped (`route_stale`), with no Clef call, no answer and no wake.
- Plain questions (a message ending in `?`, or a `[knowledge:…]` key) keep v7.14's routing.
- **Run6 replay.** The retrieval worker asks for "load all tickets". Its manager has no child that promises it, so the request goes up; Root answers `getTickets` from "ticket storage", and the worker's second turn imports exactly that. The cost: two model turns, three manager turns and two Clef calls.

### The return check

- Before a worker's done is accepted, the runtime checks that its files export each promised name in a shape a sibling can destructure and call: a named export, a member of a default object, or a default function or class of that name. A default class's or instance's methods do not count: `const { getTickets } = require(…)` gets `undefined` from a class, or an unbound method from an instance. A file whose exports the parser cannot list is given the doubt.
- An import of one of its own promised names that resolves to none of its files is a self-import (run6's create worker), when the name is not also exported.
- A missing name sends a `[contract]` message back to the worker (`contract_missing`). The message names what is missing, how to export it, and any self-import of it.
- **It is sent back up to three times**, on a counter of its own (`contract_returns`), since the turn's failure count resets after every turn. A return never throws (a thrown step replays without asking the model) and never pauses a worker.
- **The fourth done is accepted** (`contract_unmet`), and a `contract` problem goes to its manager. Rule D4 gives it back to the worker as a repair ticket, and the manager's model may retask it. A later done that exports the names closes the problem.

### One import line per function (run8)

- **Workers are told** to import each function another piece provides on its own line, with the function's name as the path, never several functions from one path. The builder links each line to the one module that exports that function, so a reader never needs to know a branch's file layout. Managers' `provided` answers say the same.
- **The builder links such a line with no model call.** `autoLink` takes the plan as a provider: of several modules exporting the wanted names, or when a module named like the path would block the only one, it picks the module of the piece the plan gives those names to. This works across a sub-manager's branch.
  - Two one-function lines that share a guessed path (`require('./dataStore')` for `loadTickets` and for `saveTickets`) are linked each on its own.
  - An import of functions the plan gives only to pieces outside a branch is that branch's boundary need. Its builder makes no model call for it, and the level that sees those modules links it by name.
- **A combined line is its reader's problem.** One import line that reads several of the plan's functions living in different modules (run8's `const { loadTickets: load, saveTickets: save } = require('./data-store')`) cannot be linked by renaming:
  - It is not linked automatically or sent to the model, and an edit that points it at one module is refused.
  - It becomes one `unresolved` problem for the reader, at the lowest level that holds the reader and every module involved, and it never relinks.
  - The reader is told to import each function on its own line, keeping its own local names (`const { saveTickets: save } = require('./saveTickets');`), so pasting the lines does not leave `save()` undefined.
- Only declared names count, so a v7.14 room's mismatches are unchanged.

### The linker and the builders read the plan

- **A planned name nobody exports is its carrier's.** At the top, an import that resolves nowhere and reads a name the plan gives a piece whose modules do not export it is a `contract` problem for that piece, never the reader's: the reader is only a site. The piece's modules lead what the reader is shown otherwise.
- **Guards on the linker model's edits.** Each refusal is a `link_edit_rejected` event:
  - an edit may not remove a function the plan gives the module's piece;
  - it may not bind a planned function to another piece's planned function (run6 bound `createTicket` to `saveTickets`, which replaces the whole store);
  - it may not bind a name its piece was told no piece promises to a planned function (run8 bound `addTicket` to `saveTickets`);
  - it may not point a planned function at a module whose piece neither carries nor exports it.
- **A branch is checked against its promise.** Below the top, once the relink loop has decided, a function the manager promised that no module of its linked branch exports is a `contract` problem for the piece below that carries it. It joins the builder's report and never relinks. The top builder does not check, since the compiler checks `start`.
- **The boundary always offers the modules that export what its manager promised**, even when a module inside the branch imports them. In run8 the append module imported the loader, which hid the loader and the saver from the level above's model.

### The reader rule (run8)

- In a planned room, a mismatch whose reader expects a name that the provider's piece never promised, while that piece's modules export every function it did promise, is the reader's to change.
  - The default stands with no model call: the reader changes.
  - The reader hears that the provider exports what the plan gives it and is never asked to add the name.
  - The validator refuses any decision, the model's included, that gives such a problem to a child holding only the provider.
- A name the plan gives another piece, read through a path that reaches the wrong module, is a misdirected path, not a name the reader made up. The reader imports it on its own line by its name.
- Run8's entry called `.start()` on every module, and the providers added `start()` exports to satisfy it. Under v7.14's rules this would be the manager model's choice (M8: two children disagree and neither side is anchored). Under this rule the entry changes, and `view-tickets` is never asked.

### The no-change repair bounce (run8)

- Run8 paused after 9.6 minutes because its entry worker answered its repair ticket with "Fixed entry module…" and `done: true`, but wrote no file. Nothing changed, nothing was relinked, and the manager went idle.
- v7.14 already reopens a problem whose assignee finished with the same files as when its ticket was sent, and closes it at the second unchanged answer. In v7.15 the ticket that goes back says so, right after its head:
  > NOTHING CHANGED IN YOUR FILES: you answered this problem as fixed, but your published files are exactly as they were when it was sent. Change the code and publish the FULL updated file; another answer that changes nothing closes the problem unfixed.

  The manager logs `repair_unchanged`.
- The second unchanged answer closes the problem as exhausted, or, while the manager's model may be asked, leaves it to the model (M4), whose default closes it. With nothing left that could change the source, the top then fails the run visibly ("Repair exhausted") instead of idling, and a lower manager tells its parent it cannot finish its branch.
- A `contract` problem the worker answered unchanged stays as it is, so it goes back once and then closes. (The slice C review found that filing a fresh contract problem on every later done let one stubborn worker spend all six of Root's rounds.)

### The compiler reads the top's plan

- **The entry belongs to the start carrier.** The "No application entry" problem goes first to the module of the piece the plan gives `start`, before any guess by imports and file name. Among several modules exporting `start()`, the compiler prefers the carrier's once their `start()` ranks tie, before the module that imports the most others.
- **The coverage gate's fallback.** The mapping model of v7.13.3 is unchanged, and it gets no planned names. When it gives no usable mapping:
  - If `start()` returned fewer callable methods than the plan has operations (the top's children's operation-tagged functions, one per operation), the plan proves a gap without the model: one method per operation. The entry hears which operations' functions it did not return. Without this, run6's false completion could recur when the coverage model answered prose.
  - Otherwise no gap is filed, and the runner is told to test the plan's operation functions that `start()` returned, under the names it returned them (`api_planned`). A wrapper such as `create: (t) => createTicket(t)` is no gap.
- **A coverage gap ends with the plan.** One sentence lists the top's children's operation functions and their pieces ("The plan's operation functions: createTicket (create a ticket) from …"). It is cut first when the problem's text is too long.
- The top reads only its own direct children's promises here, never a grandchild's.

### Composition with the managers' decisions

- **A retask keeps the child's promise.** The manager's model may give a retask `interfaces`, which replace it. They are cleaned and repaired like a split's names, a function the manager promised takes its item, and the result is written to `agents.interfaces` and mirrored to `ownership.json`.
- **A retasked sub-manager's branch is killed** (v7.14's author decision 1), and its new split must cover the kept or new promise (C5).
- **Every function a manager promised stays on exactly one child.** A retire or retask that would leave one with no piece, or put one on a second, is refused ("would have no piece"). A retire is allowed when the same decision retasks another child to carry what it carried. The rule is checked again on what is actually applied, so half of a validated pair never applies alone.
- **The manager's model sees each child's functions**, which is what the manager answers requests from. A `contract` problem clusters like an entry problem: it has only a subject, and it is never fixed against a provider.
- **The model may not give a contract back** to a piece that already had it twice (M4).
- **A retask clears** the child's contract returns, its answers and its turn notes, so its new task's done is checked against the promise again.
- **A child stuck at its split is a branch, not a worker.** It is retasked, retired or escalated, never assigned instructions it would never read.

### Dashboard

- A node's details show one faint line, `promises: name(params), …`, when the node has a promise.
- Asset URLs are `?v=7.15.0`.

### Rooms without promises

`MOCK_AI` rooms and rooms started on v7.14 have no Root promise:
- they keep v7.14's routing, prompts and retasks;
- their workers keep v7.14's advice to continue on an explicit assumption rather than wait;
- the linker's and compiler's plan rules never fire, because they act only on declared names.

The `MOCK_AI` decomposition fixture declares functions, and every mock worker passes the return check.

## The live runs behind v7.15

All four ran on v7.13.x. See [CHANGELOG-v7.13.md](CHANGELOG-v7.13.md) for the hotfix each one motivated there.

- **Run5 (f73243d3, v7.13.1).** It looped because workers wired three ways: a factory export, a direct import, and `start(store)` injection. v7.13.2 settled on imports only. In v7.15's replays:
  - run5's Root children are the tree for the walk by name;
  - run5's `module.exports = function dataStore() { return { readTickets, writeTickets }; }` does not satisfy a promise of `readTickets` or `writeTickets`, since a factory's result is not what a reader destructures.
- **Run6 (9642ff74, v7.13.1).** It completed falsely: `start()` returned only `{ getTickets }`. In v7.15's replays of its tree and files:
  - the entry-module child Clef rejected at p 0.448 is admitted as the carrier of `start`;
  - the copied example line is gone, a self-import of its own promised function is sent back, and asking for it is answered at once;
  - the `createTicket` → `saveTickets` binding is refused;
  - the view branch's storage piece that exported only `getTickets` is pruned by name to "ticket storage";
  - the retrieval worker gets `getTickets` by asking;
  - with no usable coverage mapping, fewer methods than planned operations is still a gap.
- **Run7 (4203fa2a, v7.13.3).** Its fixes are v7.13.4's. Its coverage model never returned a usable mapping (four `coverage_unchecked` events). That is the case v7.15's plan fallback covers: the runner is given the plan's operation functions, and too few methods is a gap.
- **Run8 (48a10b1d, v7.13.4).** It paused after five repair rounds. Slice C carries its fixes: one import line per function, the reader rule, the no-change repair bounce, and the guard against binding `addTicket` to `saveTickets`. The boundary also keeps the modules that export a branch's promise.

## Tests

At this release, `npm test` runs 500 tests and `npm run check` covers 70 files.

| File | Tests | What they cover |
|---|---|---|
| `test/v715-interfaces.test.js` | 25 new | Slice A: normalizing the splitter's functions, C0 to C5, repairs, the in-call retry, Clef's names call, run6's entry admitted at p 0.448, records in SQLite and `ownership.json`, the worker's own contract, the return check and its third return, a class or instance not satisfying a promise, run5's walk by name, run6's view split pruned by name, an atomic Root never told to ask, the last attempt before a pause, the `MOCK_AI` run |
| `test/v715-requests.test.js` | 16 new | Slice B: requests in the action, `matchFunction` and `ownsNeed`, an answer by name, by Clef, from one level up and from nobody, run6's retrieval worker, the own-contract answer, a crash-left hop, waiting and deferral, rooms without promises, final answers, a worker waiting for nothing, a repair turn's names, a retask voiding requests |
| `test/v715-linking.test.js` | 26 new | Slice C: contract problems at the top and in a branch, the planned provider, run8's one-line imports and its combined line, the linker guards (run6 and run8), the boundary, the entry and the coverage fallback, a gap that lists the plan, run8's reader rule and its no-change bounce, the contract bounce, and the rules shared with retire and retask |

- Existing fixtures changed where a live Root now promises `start`: the live fixtures whose Root splits give `start` to one child, and the atomic Root and the leaf fixtures that stand in for one export `start`.
- The prompt tests follow the new wording; the phrases that `test/leaf-dependencies.test.js` and `test/worker-ownership.test.js` assert are kept.

## Still open

- **Not verified live.** No live run has used v7.14 or v7.15, and no live run has yet finished with a correct, verified application. The replays above use scripted models.
- **Names a lower split adds are internal to that branch** (the lead decision). A worker in another branch that needs such a function gets `unowned`: it writes its own copy if Clef says that is its assignment, or the gap reaches Root at link time. A function other branches need belongs in the promise of the branch that writes it, and a retask with `interfaces` can add it.
- **Latency.** A worker that needs anything outside its contract takes at least two model turns: one to ask and one to write. An answer found k levels up takes 2k − 1 manager turns. Manager turns spend no budget.
- **Clef can match the wrong function.** The worker then imports a function that does something else. The linker cannot see that; it surfaces when the application is loaded or run.
- **Names, not behavior.** The return check and the branch check look at exported names only, never parameters, return shapes or what a function does. A file whose exports the parser cannot list is given the doubt.
- **Concurrent sibling splits** can each declare the same new name, since the walk sees only nodes already spawned. The builder then sees two providers, and the model or a mismatch problem decides.
- **A split that never names a promise** while Clef keeps answering YES still stops after three attempts: below the top, its manager hears it as stuck, and at the top the room pauses. On the last attempt, R6's guess from the pieces' text can be wrong, at the cost of up to three contract returns.
- **The coverage fallback counts methods.** With as many methods as planned operations, it files no gap, even when one of them does the wrong thing; the runner's test is then the only check.
- **Generic names** such as `create` or `get` are binding but never prune and never answer a request by name, so they rely on Clef.
- **Carried over from v7.14:** a Root that Clef does not split keeps its own build path; the rename check does not compare line breaks; a model path edit that resolves to the wrong module is kept; the undo of a breaking rename sees only what the static name check sees; the check for a member reached by key does not follow arrays or callbacks; linker input at one level is not split when it exceeds the model's context; and `MOCK_AI=true` still uses the older builder path.

## v7.15.1

- **Progress-aware repair rounds.** Run9 (92cc686b) failed while still converging. Each of Root's six repair rounds fixed one real bug and exposed the next assertion of the runner's sequential test: create was a placeholder, `addTicket` returned nothing, create passed no data, tickets had no id, view was empty. At "Ticket should be updateable", Root had used all six of its rounds. Now a round counts against its manager only when it makes no progress. A round makes progress when its report no longer fails the way the report of the manager's last round from the same source did, and fails like none of its last 3 rounds from that source (`PROGRESS_LOOKBACK`), so ping-pong between two failures is not progress. A report superseded before the manager paid a round for it is not compared. A source's first report counts as progress. A manager stops after 3 rounds in a row without progress (`MANAGER_MAX_STALLED`, replacing the flat 6), and a round with progress resets that count. Every round still counts toward the run's ceiling, raised to min(40, 16 + 4 × managers), the backstop for a failure that keeps moving and never passes. Each round's `repair_round` event says whether it made progress and how many rounds without progress are left, and the exhausted message says which limit ran out. A manager past its limit still decides a report that makes progress, and its model is told the rounds that report leaves, never 0.
- **Progress is read from the runner's own failure.** A run problem's detail opens with triage's prose, worded anew each round, or, with no triage, with Node's crash preamble, which filled the signature's 160 characters for every one of run9's assertions. Comparing signatures would have treated the same failure re-triaged as progress every round, and run9's moving assertions without triage as no progress (Root would have failed after 4 rounds). The compiler now stores each load or run problem's `failure` (`failureHead`): the output's error line, such as "AssertionError [ERR_ASSERTION]: Ticket should be created", plus the line of the runner's fixed test it stopped at, with paths, random ids and timestamps removed. Progress compares that failure and the files it is blamed on. Other problems still compare their signatures. Under these rules run9's rounds are progress, progress, no progress (round 3 blames entry.js for the same assertion as round 1), then progress, so it would have continued. `test/v7151-rounds.test.js` replays run9's own runner output and triage verdicts through the real compiler until the run completes. It also checks that the same failure, re-triaged in new words, ends Root after 3 rounds without progress, that a moving assertion with no triage is progress every round, that ping-pong ends after 5 rounds, and that a failure moving every round ends at the ceiling of 20.
- **A name two pieces list is placed on one piece.** In run9 (room 92cc686b), Root's Data Module listed `updateTicket` and `deleteTicket`, and so did the Update Ticket Module and the Delete Ticket Module. R3 deleted both names from all three pieces, so no piece promised update or delete. Now the manager places the name on one piece (`duplicateNames`, `repairInterfaces` in `src/interfaces.js`, called from `admitChildren`). If exactly one piece's task says it exports `NAME(`, or exactly one piece's label is the name's words ("Update Ticket Module" for `updateTicket`), that piece keeps the name, with no model call. Otherwise Clef answers one question per candidate piece (`pickPiece` in `src/model.js`), in parallel with the scope call, and the highest answer at or above 0.6 keeps it. Pieces Clef scores within 0.05 of the best are a tie: the one tied piece whose label is the name's words keeps it, else the best, and the event names the tie. A miss or an error deletes the name from all pieces, as before. The `interfaces_repaired` event says where each name was kept and why (`label matches`, `task exports it` or `Clef p=0.82`), or that it was dropped. Replayed, run9's split keeps `updateTicket` on the Update Ticket Module and `deleteTicket` on the Delete Ticket Module, with no Clef call, and the Data Module keeps `addTicket` and `getTickets`.
- **An empty placeholder is not delivered.** After six repair rounds, run9's `entry.js` still had `function update() {}` and `function del() {}`, and `start()` returned them as `update` and `delete`. Its worker never asked its manager for those functions. Now the return check (`contractReturned`, `placeholders` in `src/linker.js`) sends a worker back before any linking when a promised function has no statements, only returns nothing (`void 0`, never `void tickets.delete(id)`), or only throws a not-implemented error. For the piece that carries `start`, the same applies to each local function that `start()` returns as an operation; getters, setters, lifecycle no-ops such as `close() {}`, and names that a parameter, a destructuring or a later assignment rebinds are not read. The manager writes the send-back from the plan the way it answers a function request (`placeholderAnswer`): at each level up from the worker, the other children's promises, first by every word of the operation with the verb first (`performsOp` in `src/interfaces.js`: `update` is `updateTicket` and `del` is `deleteTicket`, but `addComment` is never `addTicket`), then with the Clef matcher that function requests use. Only a word hit whose arguments fit is returned as the operation. A Clef hit is what to write the operation with: run9's test calls `app.view(id)` and compares the result with the created ticket, which `getTickets()` returned as `view` fails. If Clef is down, the worker is told to ask its manager; if no piece up to Root promises the operation, to implement it here. The existing limit of three contract returns bounds this check, and an export the worker fixed closes its contract problem even while a placeholder remains. Replayed, run9's final `entry.js` is sent back naming `updateTicket` from the Update Ticket Module and `deleteTicket` from the Delete Ticket Module, with no model call; the round-5 version, with `view` empty, is told to write `view` with `getTickets()` from the Data Module. `test/v7151-names.test.js` adds 18 tests, for 519 in all.
- Workers talk only to their manager, and managers talk up. `canContact` now allows only a parent and its direct child: a worker messages and asks only its manager, a manager its parent and its own children (never grandchildren), and siblings reach each other through their manager, which answers from its children or asks up and never routes a question back to its asker. A message or knowledge lookup addressed to a sibling is refused with a `blocked` event, a worker's ask that names a sibling goes to its manager, and no worker's or manager's view lists a sibling or its public memory. The one exception is for reading (`canRead`): a builder acts for its manager and reads the published files of that manager's direct children, its own siblings, and nothing deeper or wider; it never messages them and reports to its manager. The `MOCK_AI` frontend now gets the backend contract from its manager.
- The same rule covers what a builder copies and what a prune verdict says. A builder reads a sibling's own files, a manager sibling's export aliases (each file once; in `MOCK_AI` too, where it used to be shown that sibling's workers' files) or the bundle that sibling's own builder linked; every copy into a builder checks who owns each file, and no other node imports another's file, not even through its manager's alias. A prune verdict (the walk up to Root, by Clef or by function name) names the owning branch only to a direct child of the manager that decided; a verdict from higher up, and the public note the splitter's own children read, say only that the piece is owned outside this branch and is imported by name. The `MOCK_AI` builder waits until its siblings publish what it links.
