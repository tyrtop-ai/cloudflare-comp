# v8 without the card writer

Owner, 2026-10-16: "throw out the fucking card writer. You're too attached to that thing and it needs to be gone."

## Roles (binding)

- **manager:** the router. It owns its children's interfaces (contracts) and the validations it holds, as a file in its repo. It never writes code (owner, 2026-10-16 05:16: "the manager NEVER writes code"). It writes files, such as that one (owner, 2026-10-16 05:17: "managers have to write files").
- **worker:** writes code. It is the only agent that does (owner, 2026-10-16 05:21: "worker - writes code. only agent that writes code").
- **splitter:** splits its manager's assignment into smaller pieces, and builds that level's validations as contracts.
- **builder:** writes the glue between the workers' interfaces, and may rename interface names.
- **compiler:** makes sure the joined code works: the box, the syntax step, the validations.
- **No prompt handler.** Owner: "why do we need a prompt handler anymore? we have a dedicated splitter?" The room creates the top manager's row; the room is the boundary with the person and the end of every line. Queued prompts and amendments go straight to the top manager as changes on its row.

## Flow (the same at every level)

1. **The room starts the run.** It creates the top manager's row: task = the prompt (the effective goal), its sources and the base it starts from, and the installed packages. There is no card step and no handler.
2. **Pre-grade.** One Clef call over `{assignment, contracts}`. At the top, `contracts` is empty: the top's splitter defines the level. If p ≤ `split_floor`, the runtime skips the split attempts (no proposals), and the splitter is asked only for this level's contracts and validations with no pieces.
3. **The splitter (`splitter-<hex16>`, a short-lived step under its manager, using the manager model, since the owner calls the splitter "essentially what you're calling manager now" and says "workers are a different model") proposes, for each attempt (up to 3):**
   - `contracts`: what this level delivers. At the top these are the deliverables. Below the top, they are the manager's own contracts (given by its parent's splitter), possibly refined: a path or names chosen, examples added.
   - `validations`: runnable checks (the existing check kinds: call/command/http/browser/file) for this level's contracts, each with `serves`. A contract of kind command/route/page carries how it runs (argv, port or static), the way `card.run` did.
   - `pieces`: `{label, task, contracts: [the names it delivers]}`. They are empty only when the pre-grade hands the level down whole (step 2). Otherwise the splitter always proposes a division, and only Clef's review decides whether it is valid (owner: "the idea is that manager always attempts to flip, and then clef is supposed to decide if that was a valide split"; "literally every manager tries to split, model can retry twice with different split parameter").
4. **Clef validates each division in one call, and never deletes.** Over the original assignment with its contracts and the pieces as written, it asks only `split_valid` (is this a valid division, without going too small) and `split_size` (owner, 2026-10-16 05:12: "here's the original model / here's the pieces / is this valid? (without going too small)"; owner, 2026-10-15 20:28: "why is clef doubting requirements for the code"). There is no review when the level has no pieces. Retry parameters depend on the objection.
5. **The splitter writes through typed functions.** Each function's result says what it stored, or exactly why it can't (its own argument checks). The runtime never repairs, reinterprets or matches what the splitter wrote, and there are no path rules or blocklists (owner, 2026-10-16: "The splitter should be given interfaces and then write via those interfaces. That's it").
6. **The manager admits the result.** It writes its contracts file (its children's contracts with their validations; the DO row indexes the file by commit).
   - **The proposal splits:** each piece becomes a `manager-<hex16>`, with its contracts on its row.
   - **It doesn't split:** one `worker-<hex16>` with the manager's contracts.
   - **Where validations live:** each is held by the lowest manager whose subtree serves it (placeChecks, unchanged).
7. **The builder joins, and the compiler verifies.** The builder is an agent: it writes the glue between the interfaces the workers created, and may rename interface names (owner: "builder - writes glue between the interfaces created by the worker. can edit interface names"). The compiler makes sure the code the builder joined actually works (owner: "compiler - ensures that the code taped together by the builder actually works"). The top verifies the exact shipped bundle.

## What goes

- **card.js as a module:** writeCard, repairCard, validateCard, prepareCard, settleCard, reviewCard, vetRequirements, rankReferences, applyVetting, providedCard, cardContracts, CARD_SCHEMA and CARD_LIMITS, card revisions and history, card_raw, card_draft, card_writers, `card:<n>` ids, the card holds (card_failed, card_blocked), and "card_rev" keys.
  - The pure check helpers move to `src/validations.js`: commandArgv, urlPathError, SELECTOR, checkSummary, testable, plus the executability rules.
- **The card's amendment path:** cardDelta, goalView card parts and the card amend writer. A change goes to the top manager as a change on its row. The manager routes it to the child whose contracts it touches (Clef routes; owner: "managers are clef models (for routing purposes)"). When no child covers it, that manager's splitter adds pieces, contracts and validations. Every level behaves the same.
- **FORMAT.card and ROLE.card / card_review** in prompts.js. The splitter's FORMAT includes `contracts` and `validations`, phrased positively and with no pinning.
- **prompt_handlers, handPrompt, handRows' handler step, `handed_by`.** The top's parent is the room; old rooms with handler rows stay readable.
- **v8 tests built on the card.** They are rewritten against the splitter's output. v7 is untouched.

## What stays, renamed

- **The validation states** (`requirement_status` becomes `validation_status`), passes keyed to exact bytes, the top verifying what ships, base_confirm (the person grants changing existing files), sources and refs, packages and the broker, interface facts in contract lines.
- **Benchmarks:** see "There are no hidden tests inside a room" below; the grader is outside the room.

## Done when

- No `card` identifier remains in v8 code paths (a grep gate in the test suite). v7 keeps its own paths.
- A scripted run splits the issue tracker: top manager, splitter, pieces, workers, builders, compiler; validations placed and passing.
- A non-splitting CLI gives top manager → one worker.
- An amendment is routed by managers.
- A bench task room grades only after completion, outside the room.
- `src/` line count before and after is reported (it should drop).

## No agent knows it is the top (owner, binding)

Owner: "the top manager shouldn't even know it's a top manager." and "the room should be able to tell when its done by observing the final compiler. That's it"

- **No top-specific behaviour in any agent or compiler.** There is no `isTop` and no `topId()` in agent logic.
  - The manager the room created is an ordinary manager whose parent is the room.
  - Anything an agent sends to its parent goes to the room when the parent is the room, and the agent can't tell the difference. An ask no manager up to the room holds archives the asker, and the compensating controls rebuild what it delivered (owner: "if it works up to root without finding it, it kills the work"; "more specifically, archived").
- **Every compiler follows the same rule.** At its level, it verifies every validation held in its subtree whose last pass is not on its level's exact bundle, in one box. So a validation runs at its holder (early) and again at each level whose bundle differs from the one it passed on. The ship-verified invariant then holds at every level, with no level knowing it is last.
- **The room observes and doesn't steer.** It is done when the compiler of the manager it created has every validation of its subtree passing on that level's current exact bundle, with nothing pending below. The export ships that bundle. That is the room's only completion rule.
- **The room's own record** of which manager it created is the room's state, not something an agent reads.

## Owner rulings, 2026-10-16 (binding), and what goes with them

1. **Only workers write code. Fixes go to workers.** A manager hands the problem to the responsible worker together with the complaint, and the worker fixes it. Clef routes the complaint down the tree to that worker.
   - Delete: decideProblems / MANAGER_SYSTEM / ROLE.manager's Qwen decisions, the M1–M8 trigger catalogue, clusterForModel, validateManagerActions, and any model call made in a manager's turn other than Clef.
2. **Managers never rewrite their children's assignments.** Clef walks the tree and routes questions; that is why managers are Clef. The original design (the splitter's output: pieces, contracts, validations) is an artifact in the manager's repo. The builder may read it. The manager routes without needing it.
   - Delete: retaskChild, retireChild as manager decisions, growth (promiseAdds, growOperation, the A2 amendment growth), and every manager-side contract rewrite.
3. **The scope walk stays. Data never moves.** Clef walking up the tree to check scope is the mechanism rule 4 uses. What goes is moving data: no piece, contract, file or row is ever moved to another branch as a result of a walk (or anything else). Delete the walk's re-placement of proposed pieces into other strands (scope_moved and the like). The walk's only outcomes are: in scope at an ancestor, so it is routed there; or in scope nowhere up to the room, so the asker is killed.
4. **Out of scope all the way up: archive, then the compensating controls rebuild.** The rule comes as one piece, in two halves:
   - **(a) Archive.** When Clef walks up from an agent's ask and no ancestor up to the room covers it, that agent is archived. Its row is archived, its subtree is archived with it, and its repo and files are kept as they are: nothing is deleted or moved. The builder leaves archived rows out of its join.
   - **(b) Rebuild what is missing.** The compensating controls replace whatever the archived agent was meant to deliver, so archiving is safe:
     1. Every contract the archived agent held is still validated. Its manager holds those validations, so at the next compile they fail or have no pass on the new bundle.
     2. The compiler's failures route (by serves, via Clef) to the part of the tree that owns that contract, which is the archived agent's manager.
     3. That manager has no live child for the contract, which is a split defect, so it goes to that manager's splitter. The splitter re-splits that level: a new piece and worker with the same contracts and validations, while the original design artifact stays as it is. Clef validates the new split like any other.
     4. The new worker writes the code, and the builder and compiler join and verify it as usual.
   - **Status:** (a) is enabled only together with (b). Steps 1–2 existed before this slice; step 3 (the re-split when no child owns a contract) and the subtree archive were built in it.
   - **Delete:** needScope's "write it yourself" answer, the end-of-line growth rule, "nobody up to Root covers it", carriersOf-based placement of asks, the uses planning, and routeFunction's growth branch. These fight this rule.
5. **No text heuristics.** Workers see their contracts and the compiler's complaints, and the validations are their level's spec. There is nothing to hide from them.
   - Delete: the wording/value classifier (isValueText, isWording, cardScope), interface-fact masking, and "secrets" masking for ordinary validations.
   - Benchmarks need no masking: the grader runs outside the room, after it finishes.
6. **No blocklists and no path rules.** Agents have their world: the commands that exist in their box and the files they can see. Nothing is blocked; anything else doesn't exist for them.
   - Delete: the command denylist, the shell-character rule, reserved commands, the "Interim" path rules in card.js and the file gate, and the benchmark tamper scan.
   - What replaces them is construction: validations run in single-use, internet-off boxes; a worker's files are paths inside its own repo, written through its `write_file` function; the harness and the solution run in separate boxes.

## What each ruling builds (not only what it deletes)

1. **The complaint goes to the worker as it is.** The manager hands the problem down with the complaint itself: the compiler's observation, verbatim. The runtime doesn't rewrite it into instructions. repairText, instructionsFor and the "Fix the cause in your part, or say plainly…" composition go.
2. **The design artifact.** The splitter's output (pieces, contracts, validations) is an artifact, the file in the manager's repo.
   - The builder reads it to know the original design: which piece delivers which interface, and where it is placed. The builder's join is driven by that artifact. builder_sources and the runtime's placement inference go.
   - The manager does not read the design. It routes with Clef only: walking the tree, asking each child whether a complaint or question concerns its scope.
3. **Each role's world, enumerated.** No blocklists and no path rules: each role is given its world, and nothing outside it exists for that role.
   - **worker:** actions are write files in its repo, ask its manager, and done. It sees its entry in the manager's artifact, the complaints routed to it, its own files, and what the broker lists. A file it writes outside its contract paths still exists only in its repo: the builder places files by the artifact's paths, so an extra file reaches no one else.
   - **splitter:** proposes pieces, contracts and validations. A validation can use what exists in a box: the installed toolchains' executables and the contracts' own commands, which the splitter is shown. A validation that uses something not in that world can't execute. That is an executability fact, not a block, and it returns to the splitter as its defect, never to a worker.
   - **builder:** sees its children's pieces and the design artifact. Its actions are renames and glue.
   - **compiler:** a fresh, single-use, internet-off box per level.
   - **harness:** its own box, separate from the solution.

## A worker's input (owner, binding)

Owner: "the workers shouldn't know about their siblings." "or about the overall project goal." "it should be literally getting handed (here is your prompt, okay have fun now) after something decided it shouldnt' split"

- **What a worker gets:**
  - **The prompt it was handed.** It is written for that piece when the split was admitted, or, when nothing split, the manager's own assignment handed down whole. It holds what to deliver, under which names and paths, and the interfaces it may call by name.
  - **Its own files.**
  - **Complaints routed to it later,** verbatim.
  - **Its world:** what the broker lists as existing for it (packages, sources or base files it was given).
- **What it doesn't get:** the goal, project facts, siblings or neighbour descriptions, its parent's description, other pieces' contract lines beyond the names its prompt hands it, validations, card wording, masking.
- **Delete:** the `goal`, `project`, `neighbor_owners`, `parent` and `contracts_you_may_use` fields of view(), withContract's requirement text, v8Inputs, and the masking.
- **The worker can't tell whether anything split** (owner: "the worker doesn't even know if it split or not"). Its prompt has the same form either way, and nothing in what it reads mentions splitting, pieces, parts, managers, siblings, a larger project or a goal.
  - The texts before this slice broke this. ROLE.worker said "the contracts of other parts you may use … the project facts, the goal as the limit of scope". PRINCIPLES, which every role shared, said "other parts only through their contracts", "the project facts" and "say so plainly … other part's contract". The worker-facing repair text said "Fix the cause in your part, or say plainly which other part's contract it lies in".
  - Fix: the worker's system text and every message it receives are rewritten in terms of its own prompt only: what it delivers, the names it was given to call, its files, the complaint. PRINCIPLES is split per role, so no worker-facing line describes the structure. A prompt-lint test fails on structure words in worker-facing text.
- **Delete PRINCIPLES.** Its first line is "You are one of many agents building one project together", and every role's system prompt starts with it (`systemPrompt = PRINCIPLES + ROLE + FORMAT`). That is the opposite of the owner's rule that agents don't know other agents exist. Each role's system text is its own job and its own world only, with no shared preamble. The prompt-lint test asserts that no generative role's system text mentions other agents, parts, a project, checks written by others, or repairs reaching other owners.
- **Examples are built from the validations** (owner: "the worker doesn't get validations." "The example sohuld be built from the validation.").
  - The worker's prompt carries examples. The runtime renders each one from a validation the splitter wrote for that contract, deterministically and without a model call: the input the validation gives and what it observes.
  - A command validation gives `python3 convert_temp.py 100 C → its output contains 212`.
  - A browser validation gives `open /create.html, fill the field labelled "Title", click the button "Create" → "Test Ticket" appears`.
  - A call validation gives `f(args) → result`.
  - The worker never receives the validation itself: not its kind, its steps as data, its id, its expect object, or that it exists.
  - There is one source of examples, the validations. Splitter-written free-text examples and a contract's own `examples` field are not used for workers.
- **Three different examples per contract** (owner: "there must 3 different examples for each contract").
  - The splitter writes, for every contract that is called or run (functions, commands, routes), validations that render to at least 3 different examples: different inputs or steps. Rendered examples that come out identical don't count twice.
  - A contract with fewer than 3 different examples is what the splitter's `done` returns inside its own session, so the splitter adds them there. It is never padded by the runtime and never sent to a worker short.
  - Benchmark: the 3 come from the splitter's own validations of the task's prompt, as in any room.
- **There are no "hidden tests" inside a room.** The benchmark's own tests are the grader, and the grader sits outside the system.
  - **Before** (src/bench.js): a bench room started from a fixed card with one deliverable and one "hidden requirement", whose check ran the benchmark's tests inside the room's compiler. A failure ended the room `benchmark_failed` without repair, and the room had no validations of its own.
  - **Now:** a bench task room is an ordinary room. Its prompt is the task's prompt (the signature and docstring). The splitter writes that level's validations from it like any other, with 3 examples per contract, and the room iterates against its own validations only. When the room is done, the BenchRun grades the shipped bundle in the harness's own box. A failing grade goes back into the room as a complaint, until the room is done (owner, 2026-10-16 05:54: "why does it not go back?" "it should go back until done, just like anything else?").
  - **Delete:** the bench card, hidden requirements, the `hidden` flag, `benchmark_failed`, and every masking of hidden validations.
- **The three-examples rule covers only contracts that are called or run** (owner, 2026-10-16: "only to contracts that are called or run"): functions, commands and routes. Pages, files, docs and data owe none.

## Every model works through functions (owner, 2026-10-16, binding)

Owner: "every model should work that way, where the runtime should only be interfaces exposed to the models." "not parsing the models output, but functions exposed to the models. for every model. For every interaction." Also: "the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them." "like the runtime should only be exposing functions that make other agents visible or show what the workers can do. That's it."

- Each model works in a session of function calls (Workers AI `tools` → `tool_calls` → `tool` results). The runtime defines the functions and runs them. It never parses a model's prose or a flat answer, and never repairs, reinterprets or matches what a model wrote.
- A function's result is all the feedback there is: it stores what was asked, or says exactly why it can't (its own argument checks), and reports what exists. A mistake is a function result inside the model's own session, not a runtime retry, a defect list or a repair.
- What the runtime may expose: what exists in the agent's world (other agents' names and contracts it may use, its files, its packages), and what it can do (write a file, run its examples in its box, ask by name).
- What goes: `readLevel`'s lenient reading (name resolution, twins, inferred kinds and runs, route patterns, step splitting, throws-in-expect), the splitter's defect/retry loop, the worker's file-block and control-block parsers, format fallbacks, `code_retry`, `rewriteFile`, the await fixer, the runtime's glue writer and relinking, and `linkComponents` parsing.
- **Managers (Clef) work through functions too** (owner, 2026-10-16: "worker asks it manager (clef) where does it this go, clef walks up the tree to find it, which is a function"). The runtime does not walk the tree, pick the moment, or ask Clef yes/no questions in a loop (the former `askUp`, `resolveAsk`, `routeComplaint`, `routeChange`). A manager's turn is Clef choosing among the functions it has: each available function is one of Clef's typed options, scored, and the highest is called. A walk is a chain of managers each calling `ask_parent`; the room, as the top manager's parent, archives on an ask no one above holds, then the compensating controls rebuild.

### Interfaces, per role
- **Splitter:** `contract`, `validation`, `piece`, `level`, `done`. `done` returns what the owner's rules still need (three different examples per called or run contract), or hands the level to Clef.
- **Worker:** `read_file`, `write_file`, `run_examples` (its examples in its own box, as the compiler would run them), `ask` (by name, through the broker), `done`.
- **Builder:** read its children's files and the design artifact, `write_file` (glue), `rename` (interface names), `done`.
- **Source reading:** `note` for what a linked page says.
- **Manager (Clef):** `children()` (each live child's label and the contracts it delivers, never the tasks its splitter wrote: owner, "the manager doesn't need to know that, that's why we use an artifact for that"), and its level's own choices (split or hand down; admit or retry a split; whether a document meets its question).
  - **On an ask:** `answer(contract)` to the asker, `grant(package)` down the asker's line, or `ask_parent(need)` (the same call one level up). An ask no manager up to the room holds archives the asker at the room (rule 4). No level grows for an ask.
  - **On a complaint or a change:** `route_to(child)`, or `extend` (hands it to its splitter): for a change, or for a complaint naming a contract no live child delivers (rule 4 (b) 3).
