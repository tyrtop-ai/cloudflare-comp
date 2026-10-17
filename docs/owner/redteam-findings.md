# Red-team findings

Every finding the prompt red team (`.claude/workflows/prompt-redteam.js`) has made, round by round, with each judge's vote and reason, written from the workflow journals by `scripts/redteam-findings.mjs`. Status and fixes are tracked in `drift.md`.

## Round 1

47 findings: 23 confirmed, 23 the same issue as a confirmed one, 1 rejected.

### R1-chrono-1: v8 workers still answer in parsed file blocks, not functions

- **Verdict:** confirmed (3 of 3)
- **Kind:** drift
- **Where:** `src/model.js:722`, live in v8
- **Owner (2026-10-16 20:43):** every model should work that way, where the runtime should only be interfaces exposed to the models. not parsing the models output, but functions exposed to the models. for every model. For every interaction.
- **What the code does:** levelWorkerTurn (src/index.js:9262) calls decide(...,{v8:true}). That goes to decideV8 (src/model.js:722-735), which has the worker answer in '=== FILE ===' blocks plus a control-JSON block (WORKER_FORMAT, src/prompts.js:26-35). workerAction parses the answer (model.js:724). A parse or control error triggers a retry with RETRY.worker, and the room logs format_fallback, implicit_end and code_retry fallbacks (index.js:9265-9268). A file the token cap cut off is written again by a second model call, rewriteFile (index.js:9294, model.js:743), whose prose goes through singleFileText. Linked-page summaries are also prose read from the model (sourceModel, model.js:875). CHANGELOG-v8.md:351-358 says only the session and the splitter moved to functions. Every v8 worker turn runs this path.
- **What the owner's words require:** The worker, like the splitter, works in a session of functions the runtime exposes (owner: 'for every model. For every interaction'). Remove the file-block and control-block parsers, the format retries and fallbacks, and rewriteFile.
- **Votes:**
  - chrono: real. The quote is the owner's, but its heading is 2026-10-16 20:40, not 20:43. The code matches the finding. decideV8 (model.js:722-735) parses '=== FILE ===' and control blocks with workerAction and retries with RETRY.worker on a parse or control error. levelWorkerTurn (index.js:9262-9268) logs format_fallback, code_retry and implicit_end, and index.js:9294 calls rewriteFile, whose answer goes through singleFileText. This is live on every v8 worker turn (levelTurn:8878). 'for every model. For every interaction' rules it out.
  - code: real. The quote is the owner's verbatim, but it is at 20:40, not 20:43. Verified: levelWorkerTurn (index.js:9262) calls decide v8, and decideV8 (model.js:722-735) parses file blocks and the control block and retries with RETRY.worker. index.js:9265-9268 logs format_fallback, code_retry and implicit_end. rewriteFile at 9294 reads prose through singleFileText. CHANGELOG:353 says only the session and the splitter moved to functions. The fix follows from 'for every model. For every interaction.'
  - record: real. The quote is verbatim, but its heading is 2026-10-16 20:40, not 20:43. Verified: levelWorkerTurn (index.js:9262) calls decide({v8:true}), which goes to decideV8 (model.js:722-735). That parses WORKER_FORMAT file/control blocks (prompts.js:26-35), retries with RETRY.worker, logs format_fallback/code_retry/implicit_end (index.js:9265-9268) and calls rewriteFile (index.js:9294). This is live on every v8 worker turn and contradicts 'not parsing the models output ... for every model. For every interaction.'

### R1-chrono-2: Runtime, not Clef functions, walks the tree and routes

- **Verdict:** confirmed (3 of 3)
- **Kind:** drift
- **Where:** `src/index.js:9085`, live in v8
- **Owner (2026-10-16 20:46):** i mean, think about it. worker asks it manager (clef) where does it this go, clef walks up the tree to find it, which is a function || 2026-10-16 20:43: "not parsing the models output, but functions exposed to the models. for every model. For every interaction."
- **What the code does:** routeHeld (index.js:8985-8997) loops over held problems and dispatches them to runtime methods. askUp (9085-9113) is a runtime for-loop up agentAbove() that asks Clef a yes/no question at each manager (inScope, model.js:211) and archives the asker at the end. routeComplaint (9007-9024) first picks the child by runtime rules (a file's owner, then serves, then all kids) and asks Clef (routeAmong) only to break a tie. resolveAsk (9115-9130) matches by exact name first, then calls matchContracts. routeChange (9210) asks routeAmong and applies a 0.5 cut. At no point does Clef choose among functions. This runs whenever a v8 room has asks, complaints or changes.
- **What the owner's words require:** A manager's turn is Clef choosing among the functions it has, and a walk up the tree is managers calling a function one level up. Remove the runtime's askUp/resolveAsk/routeComplaint/routeChange loops.
- **Votes:**
  - chrono: real. Both quotes are verbatim, but the dates are off by one heading: 'i mean, think about it' is at 20:43 and 'not parsing...' at 20:40. That 20:43 prompt answers Claude's 'I left Clef as it is... Tell me if you want that changed too'. The code matches. askUp (index.js:9085-9111) is a runtime for-loop up agentAbove() that asks inScope with a 0.5 cut and archives at the end. routeComplaint (9007-9024) picks by owner, then serves, then all kids, and asks routeAmong only to break a tie. resolveAsk matches the exact name before matchContracts. routeChange applies a 0.5 cut. Clef is never offered functions.
  - code: real. Both texts are verbatim owner words, but they sit at 20:43 and 20:40, not 20:46 and 20:43. The 20:43 line answers Claude's 'Tell me if you want that changed too' about leaving Clef as it was. Verified: askUp (9085-9113) is a runtime for-loop that asks inScope with a 0.5 cut. routeComplaint (9007-9024) picks the child by runtime rules and calls Clef only on a tie. resolveAsk tries an exact name first, then matchContracts. routeChange uses routeAmong with a 0.5 cut. Clef is offered no functions.
  - record: real. The quotes are verbatim, but the headings are shifted (the 'think about it' line is 20:43, the 'not parsing' line is 20:40). The owner wrote it in answer to Claude's 'I left Clef as it is ... Tell me if you want that changed too.' Verified: askUp (index.js:9085-9111) is a runtime for-loop asking inScope with a 0.5 cut. routeComplaint (9007-9024) picks by owner, then serves, then all kids, and asks routeAmong only to break ties. resolveAsk matches by exact name, then matchContracts. Clef is never offered functions.

### R1-chrono-3: Runtime writes glue and renames; builder is no agent

- **Verdict:** confirmed (3 of 3)
- **Kind:** drift
- **Where:** `src/glue.js:259`, live in v8
- **Owner (2026-10-16 05:21):** builder - writes glue between the interfaces created by the worker. can edit interface names || 2026-10-16 20:08: "the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them."
- **What the code does:** The v8 builder is a runtime node with no model turn (pieceBuilderTurn, index.js:3841). Its join calls linkBundle, and writeGlue (glue.js:259-288) writes the glue itself: shims, package markers and path scripts. The event says 'The runtime wrote N glue file(s)' (index.js:4127). The runtime also renames references by folding case, '_' and '-' (canonicalName glue.js:41, renameFromRun index.js:4154). Only leftover references go to linkComponents. Its JSON answer is parsed and retried on a parse error (model.js:805-809), and its request lists every function contract in the whole tree as other_modules_exports (index.js:4160-4165).
- **What the owner's words require:** The builder, as an agent working through functions, writes the glue between the workers' interfaces and renames interface names. The runtime writes no glue and makes no renames on the builder's behalf.
- **Votes:**
  - chrono: real. Owner, 05:21: 'builder - writes glue... can edit interface names'. Owner, 20:08: the runtime shouldn't do 'the agents work for them'. In the code, pieceBuilderTurn (index.js:3841) has no model turn. writeGlue (glue.js:259-288) writes shims, package markers and path scripts, and linkNotes logs 'The runtime wrote N glue file(s)' (index.js:4127). renameFromRun renames by canonicalName folding before any model call (index.js:4153-4154). linkComponents parses JSON and retries on a parse error (model.js:803-809). All of this is live in v8.
  - code: real. The 05:21 quote ('builder - writes glue... can edit interface names') and the 20:08 quote are verbatim and no later prompt overrides them. Verified: pieceBuilderTurn (3841) makes no model turn of its own. writeGlue (glue.js:259-288) writes shims, package markers and path scripts. linkNotes logs 'The runtime wrote N glue file(s)'. renameFromRun runs before linkComponents (4154). linkComponents parses JSON and retries (model.js:803-811). fns is every promised function in the tree (4160).
  - record: real. Owner, 05:21: 'builder - writes glue ... can edit interface names'. Owner, 20:08: the runtime must not do 'any of the agents work for them'. Verified: pieceBuilderTurn (index.js:3841) is a runtime row. writeGlue (glue.js:259-288) writes shims, markers and path scripts, and the event says 'The runtime wrote N glue file(s)' (index.js:4127). renameFromRun renames 'by the runtime' (index.js:4154), and only leftover references go to linkComponents, whose JSON answer is parsed.

### R1-chrono-4: done re-adds 'each contract delivered by at most one piece'

- **Verdict:** confirmed (3 of 3)
- **Kind:** drift
- **Where:** `src/splitter.js:144`, live in v8
- **Owner (2026-10-16 16:14):** > Open question: rules 7, 8 and 10–13. Should “one file, one owner” and “every contract delivered by exactly one piece” stay hard rules, or become something Clef judges in its split review? ... you added those yourself.
- **What the code does:** missingOf (splitter.js:144-147) adds 'X is delivered by N pieces (...); each contract is delivered by at most one.', and done (splitter.js:164-166) will not complete the level until that is fixed. The done tool text (prompts.js:114) and CHANGELOG-v8.md:356 present the rule as one of 'the owner's rules', and test/splitter.test.js:147 pins it. Clef's review already receives the same fact as division.delivered_by_several (validations.js:429-447, model.js:155-163). This runs on every v8 split that has pieces.
- **What the owner's words require:** Drop the at-most-one-piece rule from done, and stop calling it the owner's in the tool text, the changelog and the test. done's only rule is three different examples for each contract that is called or run. Whether the division is sound is Clef's call.
- **Votes:**
  - chrono: real. At 16:14 the owner answered Claude's question about whether 'every contract delivered by exactly one piece' stays a hard rule: 'you added those yourself.' missingOf (splitter.js:144-147) still adds 'each contract is delivered by at most one', and done stays open until it is fixed (splitter.js:164-166). The done tool text (prompts.js:114), the splitter.js header, CHANGELOG-v8.md:356 and test/splitter.test.js:147 all present it as the owner's rule. It is live on every v8 split.
  - code: real. At 16:14 the owner answered Claude's question about the 'delivered by exactly one piece' hard rule with 'you added those yourself.', and at 20:08 he said the runtime shouldn't enforce process. Verified: missingOf (splitter.js:144-147) still adds 'delivered by at most one', and done stays open on it. The done tool text (prompts.js:114), CHANGELOG:356 and the splitter.js header present it as the owner's rule. test/splitter.test.js:147 pins it.
  - record: real. Owner, 16:14: 'you added those yourself.' This answers Claude's question whether 'every contract delivered by exactly one piece' stays a hard rule. Verified: missingOf (splitter.js:144-147) adds 'delivered by at most one', and done stays open on it (splitter.js:164-166). The done tool text (prompts.js:114), the splitter.js header and CHANGELOG-v8.md:356 call it the owner's rule, and test/splitter.test.js:147 pins it.

### R1-chrono-5: Byte-identical answer to a complaint still holds the room

- **Verdict:** confirmed (3 of 3)
- **Kind:** drift
- **Where:** `src/index.js:9432`, live in v8
- **Owner (2026-10-16 20:06):** > Unchanged files: when a worker sends a file back byte-identical, the room drops it silently and then escalates. That’s what stopped both to-do runs. this should be impossiblefor the worker to do || 2026-10-16 19:44: "3 & 4 are issues with the runtime / routing"
- **What the code does:** putFile silently drops a byte-identical file ('nothing changed; no commit', index.js:5871). compileLevel then sees the same bundle input that its complaints went down for and calls escalate('checks_failed', 'The complaints ... left its files as they were'). That escalation travels up to the room as a hold for the person (index.js:9432). Nothing in the worker's interface prevents or reports an unchanged answer. This is still the exact behaviour the owner was quoted.
- **What the owner's words require:** Answering a complaint with unchanged files must not be possible for the worker. When it does happen, the cause is in the runtime or the routing, and is fixed there instead of escalating a hold.
- **Votes:**
  - chrono: real. At 20:06 the owner quoted 'Unchanged files: ... drops it silently and then escalates' and answered 'this should be impossiblefor the worker to do'. At 19:44 he said '3 & 4 are issues with the runtime / routing'. putFile still returns silently on identical content (index.js:5871). compileLevel escalates checks_failed when compile_reported.input equals the new input (index.js:9432), and at the top that is a room hold. The behaviour is unchanged.
  - code: real. The 20:06 quote answers exactly this behaviour, and the 19:44 quote says 3 and 4 are runtime or routing issues. Verified: putFile returns silently on unchanged content (index.js:5871). compileLevel then escalates checks_failed when compile_reported.input matches (9432). escalate at the top goes to holdRoom (9042-9055). Nothing has changed.
  - record: real. Owner, 20:06, on exactly 'Unchanged files ... drops it silently and then escalates': 'this should be impossiblefor the worker to do'. Owner, 19:44: '3 & 4 are issues with the runtime / routing'. Verified: putFile still returns silently on identical content (index.js:5871). compileLevel escalates checks_failed when compile_reported.input is unchanged (index.js:9432), and at the top that becomes a room hold.

### R1-chrono-6: Full splitter context still holds split_failed; approved changes not made

- **Verdict:** confirmed (3 of 3)
- **Kind:** drift
- **Where:** `src/index.js:8719`, live in v8
- **Owner (2026-10-17 00:55):** why didn't you just..do them? || 2026-10-17 00:53: "are you doing those?" || 2026-10-17 00:25 (on Claude's proposal that a full context start a fresh splitter session continuing from level(), and that each call count against the room's turn budget): "it wasn't the question. I don't understand the need" || 2026-10-16 23:20 (on 'The room now holds with split_failed'): "what?"
- **What the code does:** session() ends with reason 'context' when the window is full (src/session.js:67). splitStep then escalates split_failed with no level, which holds the room (index.js:8716-8719). A split step spends one turn however many calls it makes (index.js:8703, turn+1). Commit 4ae517b (00:31) only removed the 100-call cap. Neither proposed change exists. test/v8-levels.test.js:150 pins the split_failed hold.
- **What the owner's words require:** Make both changes the owner asked about. A full context starts a fresh splitter session with the same functions that carries on from level() until done, so nothing is held or handed down. Each call counts against the room's turn budget.
- **Votes:**
  - chrono: real. At 00:25 Claude proposed two changes: a fresh session when the context fills, and counting each call against the turn budget. The owner then asked 'are you doing those?' (00:53) and 'why didn't you just..do them?' (00:55). Commit 4ae517b only dropped the 100-call cap. session.js still returns reason 'context', splitStep escalates split_failed (index.js:8715-8720), and a split step spends one turn (spendsTurn, index.js:8014). test/v8-levels.test.js:150 pins the hold.
  - code: real. At 00:25 Claude proposed a fresh session on a full context and counting each call against the turn budget. The owner answered 'are you doing those?' (00:53) and 'why didn't you just..do them?' (00:55). Verified: session.js:66-67 returns reason 'context'. splitStep (8714-8720) escalates split_failed. turn+1 is charged once per split step (8703, spendsTurn). Commit 4ae517b only removed the cap. test/v8-levels.test.js:150-158 pins the split_failed hold.
  - record: real. Claude asked 'Want me to make both changes?' (quoted at 00:25: a fresh session when the context fills, and counting each call against the turn budget). The owner answered 'are you doing those?' (00:53) and 'why didn't you just..do them?' (00:55). Verified: session.js returns reason 'context', and splitStep escalates split_failed (index.js:8716-8720). A split step does turn+1 once (8703, spendsTurn). Commit 4ae517b only removed the cap. test/v8-levels.test.js:150 pins the hold.

### R1-chrono-7: Bench grade does not go back until done by default

- **Verdict:** confirmed (3 of 3)
- **Kind:** drift
- **Where:** `src/bench-run.js:45`, live in v8
- **Owner (2026-10-16 05:54):** > When the room finishes, the benchmark run grades the shipped bundle once, in the harness’s own box. > That grade never goes back into the room: no complaint, no event, no example. why does it not go back? it should go back until done, just like anything else?
- **What the code does:** BENCH_DEFAULTS.feedback is 'once' (bench-run.js:45), so a failed grading settles the task and never goes back. 'until_done' is opt-in, and even then it stops after MAX_GRADE_ROUNDS = 5 (bench-run.js:47,196). The dashboard's default option is 'Once: ... (pass@1)' (public/index.html:182), and tests pin 'once' (test/bench-run.test.js:131,424,476). Every benchmark run takes this path.
- **What the owner's words require:** The grader's failure goes back to the room as a complaint until the room is done, like anything else, with no invented round cap.
- **Votes:**
  - chrono: real. At 05:54 the owner answered Claude's 'That grade never goes back into the room' with 'why does it not go back? it should go back until done, just like anything else?' No later prompt overrides it. BENCH_DEFAULTS.feedback is 'once' (bench-run.js:45). Even with 'until_done', graded() stops at MAX_GRADE_ROUNDS = 5 (bench-run.js:47,196). The UI defaults to 'Once ... (pass@1)' (index.html:182).
  - code: real. At 05:54 the owner rejected 'That grade never goes back into the room' with 'it should go back until done, just like anything else?'. Verified: BENCH_DEFAULTS.feedback is 'once' (bench-run.js:45), and MAX_GRADE_ROUNDS = 5 gates until_done (47, 196). The UI default option is 'Once ... (pass@1)' (index.html:182, app.js:721). Tests pin 'once' (bench-run.test.js:131, 424).
  - record: real. Owner, 05:54, rejecting 'That grade never goes back into the room': 'why does it not go back? it should go back until done, just like anything else?' Verified: BENCH_DEFAULTS.feedback is 'once' (bench-run.js:45), and MAX_GRADE_ROUNDS = 5 gates until_done (bench-run.js:47, 196). The dashboard's default option is 'Once ... (pass@1)' (index.html:182).

### R1-chrono-8: rulings.md says the grade never enters the room

- **Verdict:** confirmed (3 of 3)
- **Kind:** record
- **Where:** `docs/owner/rulings.md:130`, not live
- **Owner (2026-10-16 05:54):** why does it not go back? it should go back until done, just like anything else?
- **What the code does:** rulings.md:130 records as the owner's binding ruling: 'the BenchRun grades the shipped bundle once ... That grade never enters the room: no complaint, no event, no example.' That is the exact text the owner pushed back on. The code's 'once' default (bench-run.js:45) follows this record.
- **What the owner's words require:** Record the owner's ruling instead: the grade goes back to the room until done.
- **Votes:**
  - chrono: real. rulings.md:130 says 'grades the shipped bundle once ... That grade never enters the room: no complaint, no event, no example.' That is Claude's proposal, which the owner rejected at 05:54 ('why does it not go back? it should go back until done'). The record contradicts the owner.
  - code: real. rulings.md:130 reads 'That grade never enters the room: no complaint, no event, no example.' That is Claude's own proposal, which the owner rejected at 05:54 ('why does it not go back? it should go back until done'). The record contradicts the ground truth.
  - record: real. rulings.md:130 reads 'grades the shipped bundle once ... That grade never enters the room: no complaint, no event, no example.' That is the proposal the owner rejected at 05:54 ('why does it not go back? it should go back until done').

### R1-chrono-9: Path rules still refuse and lecture workers and splitters

- **Verdict:** confirmed (3 of 3)
- **Kind:** drift
- **Where:** `src/index.js:9274`, live in v8
- **Owner (2026-10-16 05:39):** there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists. || 2026-10-15 15:57: "in general I never want to tell an agent what they can't do. I want it to just simply be archiecturally the only path for them"
- **What the code does:** In the v8 worker turn, pathError(own) refuses a file whose name segments go beyond [A-Za-z0-9_.-] or that is over 512/255 characters (index.js:9274; container/build-path.mjs:26-44). The worker is told 'Not written: ... use only letters, digits, '_', '-' and '.' ... rename the file'. memory/ files are dropped silently (index.js:9273), and putFile throws 'Workers cannot write this path' (index.js:5841). The splitter's contract() refuses paths under components/, memory/, .recursive/ and glue/ with 'choose a project path outside ...' (contracts.js:30,56,333-334). Check paths containing '..' or %2e are refused (validations.js:57-61). rulings.md:25 still lists 'paths' and 'the safety rules still waiting on per-check boxes' as hard rules.
- **What the owner's words require:** No path rule refuses what an agent writes or tells it what it can't do. An agent's world is its own repo and what exists, and the runtime's own folders stay outside that world by construction.
- **Votes:**
  - chrono: real. Owner, 05:39: 'there should be no path rules for agents'. Owner, 2026-10-15 15:57: 'I never want to tell an agent what they can't do'. In the code, levelWorkerTurn runs pathError(own:true) (index.js:9272-9277). build-path.mjs:34-35 refuses names outside [A-Za-z0-9_.-] and '.git' and tells the worker to 'rename the file'. memory/ files are dropped silently, and putFile throws 'Workers cannot write this path'. contracts.js:333 refuses the RUNTIME_PREFIXES with 'choose a project path outside ...'. rulings.md:25 lists 'paths' as a hard rule. All of this is live.
  - code: real. Owner, 05:39: 'there should be no path rules for agents'. Owner, 2026-10-15 15:57: 'I never want to tell an agent what they can't do'. Verified: levelWorkerTurn drops memory/ files (9273) and refuses names through pathError own ('use only letters, digits... rename the file', build-path.mjs:34-35). putFile throws 'Workers cannot write this path' (5841). contract() refuses RUNTIME_PREFIXES ('choose a project path outside ...', contracts.js:30, 333). urlPathError refuses '..' and %2e. rulings.md:25 still lists 'paths' among the hard rules.
  - record: real. Owner, 05:39: 'there should be no path rules for agents ... we don't block things here'. Owner, 15:57: 'I never want to tell an agent what they can't do'. Verified: levelWorkerTurn runs pathError(own) and tells the worker 'Not written: ... use only letters, digits ... rename the file' (index.js:9272-9277, build-path.mjs:34-35). memory/ files are dropped silently (9273). The splitter's contract() refuses RUNTIME_PREFIXES with 'choose a project path outside ...' (contracts.js:30, 334). urlPathError refuses '..' and %2e (validations.js:61-66).

### R1-chrono-10: Runtime enforces worker process: drops files, caps asks, overrides done

- **Verdict:** confirmed (3 of 3)
- **Kind:** drift
- **Where:** `src/index.js:9352`, live in v8
- **Owner (2026-10-16 20:08):** in general though - the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them. like the runtime should only be exposing functions that make other agents visible or show what the workers can do. That's it.
- **What the code does:** workerAsks (index.js:9338-9360) sends only the first MAX_REQUESTS = 8 asks (interfaces.js:307, index.js:9342) and filters out repeated asks. A file that refers to a name the worker is still asking for is not written at all (wrote_before_answer, 9346-9353). An ask the runtime can't read marks the turn unheard and counts a failure (9355-9358, 9325). When a worker sets done without a delivered file, the runtime flips done to false (delivered_nothing, 9278-9282).
- **What the owner's words require:** The runtime only exposes functions and does what they're called with. It doesn't drop the worker's files, cap or filter its asks, or override its done.
- **Votes:**
  - chrono: real. Owner, 20:08: 'the runtime shouldn't be enforcing any sort of process'. workerAsks (index.js:9338-9360) does exactly that. It sends only MAX_REQUESTS = 8 asks (interfaces.js:307) and filters out repeated asks. It forces wait=true and done=false and drops any file that names an asked-for name (wrote_before_answer). An unreadable ask is marked unheard, which counts as a failure (index.js:9325). index.js:9278-9282 flips done to false when no file was delivered. This runs on every v8 worker turn.
  - code: real. The 20:08 quote is verbatim. Verified in workerAsks (9338-9360): it caps asks at MAX_REQUESTS = 8 (interfaces.js:307), filters repeated asks, forces wait = true and done = false, and drops files that refer to an asked name (wrote_before_answer). An unheard ask counts a failure (9325). levelWorkerTurn flips done to false when no file was delivered (9278-9282).
  - record: real. Owner, 20:08: 'the runtime shouldn't be enforcing any sort of process'. Verified in workerAsks (index.js:9338-9360): asks are capped at MAX_REQUESTS=8 (also protocol.js:212) and repeated asks are filtered. A file referring to an asked name is dropped (wrote_before_answer), and wait/done are forced. done is overridden to false when no file was delivered (9278-9282), and an unread ask counts as a failure (ask_unheard).

### R1-chrono-11: Split bar rises with depth: managers judged differently

- **Verdict:** confirmed (3 of 3)
- **Kind:** drift
- **Where:** `src/index.js:858`, live in v8
- **Owner (2026-10-15 22:22):** yeah, I want all of the managers to be exactly the same. || 2026-10-16 05:30: "the top manager shouldn't even know it's a top manager."
- **What the code does:** splitBar (index.js:858) returns the room's valid bar at depth ≤1 and a bar that rises toward 0.95 deeper down (t+(0.95-t)*min(d-1,h)/h). splitStep uses it to admit or retry every split (index.js:8730). A manager's split is therefore judged by where it stands in the tree, and the top levels get a different bar from the rest.
- **What the owner's words require:** Every manager's split is judged the same way, and nothing depends on its depth.
- **Votes:**
  - chrono: real. Owner, 2026-10-15 22:22: 'I want all of the managers to be exactly the same.' Owner, 05:30: 'the top manager shouldn't even know it's a top manager.' splitBar (index.js:858) returns the room's bar at depth ≤1 and t+(0.95-t)*min(d-1,h)/h deeper down. splitStep uses it as validBar for every v8 split review, so how a manager's split is judged depends on its depth. No prompt asks for that.
  - code: real. Owner, 2026-10-15 22:22: 'I want all of the managers to be exactly the same'. Owner, 05:30: the top 'shouldn't even know it's a top manager'. Verified: splitBar (index.js:858) gives the room's bar at depth 1 or less and a bar rising toward 0.95 deeper down. splitStep uses it to admit every split (8730). No prompt asks for a bar that depends on depth.
  - record: real. Owner, 22:22 (answering 'what makes the root manager different'): 'I want all of the managers to be exactly the same'. Owner, 05:30: the top manager shouldn't know it's top. No prompt asks for a depth-dependent bar ('without going too small' is Clef's judgment, 05:12). Verified: splitBar (index.js:858) returns t at depth ≤1 and a rising bar deeper, and splitStep uses it for every v8 split (8730).

### R1-chrono-12: Worker context clipped: complaint, complaint count, own files

- **Verdict:** confirmed (3 of 3)
- **Kind:** extra
- **Where:** `src/checks.js:216`, live in v8
- **Owner (2026-10-16 19:41):** how is this possible - this is the place where i WANT worker context? || 2026-10-16 05:39: "A manager hands the problem to the worker with the complaint, and the worker fixes it."
- **What the code does:** The compiler's observation is cut to 900 chars (checks.js:216), the problem row to 950 (index.js:2816) and the worker's message to 1600 (index.js:9029). Only the first MAX_PROBLEMS_PER_REPORT = 12 complaints of a report are routed, and the rest are dropped (problems.js:24, index.js:9544). A worker's own files go whole only up to FILES_BUDGET = 24000 chars. After that it gets a 3000-char start marked clipped, then paths only (index.js:113-127), and it is told to leave a clipped file as it is (prompts.js:34). No prompt asks for any of these clips.
- **What the owner's words require:** The worker gets every complaint whole and its own files whole, with no runtime clip on worker context.
- **Votes:**
  - chrono: real. I verified the clips. checks.js clips each detail to 900 characters, insertProblem to 950 (index.js:2816) and deliverComplaint to 1600. Only items.slice(0, MAX_PROBLEMS_PER_REPORT = 12) are routed (index.js:9544). sentFiles budgets 24000 characters, then sends a 3000-character clipped start, then paths only (index.js:113-127), and prompts.js:34 tells the worker to leave a clipped file as it is. No prompt asks for these clips. The owner said 'this is the place where i WANT worker context' (19:41) and 'hands the problem to the worker with the complaint' (05:39).
  - code: real. These are clips no prompt asked for, on the context the owner said he WANTS a worker to have (19:41), and the worker is told to leave clipped files alone, which tells an agent what it can't do. Verified: checks.js:216 cuts at 900, insertProblem at 950 (2816), and deliverComplaint at 1600. MAX_PROBLEMS_PER_REPORT = 12 (9544). FILES_BUDGET = 24000 with a 3000-char clipped start (113-127). prompts.js:34 says 'leave it as it is'.
  - record: real. No prompt asks for clipping worker context. Owner, 19:41: 'this is the place where i WANT worker context'. Owner, 05:39: the manager hands the problem 'with the complaint'. Verified: the observation is clipped to 900 (checks.js:216), the problem row to 950 (index.js:2816) and the message to 1600 (index.js:9029). Only items.slice(0,MAX_PROBLEMS_PER_REPORT=12) are routed (index.js:9544). sentFiles' FILES_BUDGET 24000 with a 3000-char clipped head (index.js:113-127), and the worker is told to leave clipped files (prompts.js:34).

### R1-chrono-13: Invented repair-round and rebuild caps hold the room

- **Verdict:** confirmed (3 of 3)
- **Kind:** extra
- **Where:** `src/index.js:323`, live in v8
- **Owner (2026-10-16 05:54):** it should go back until done, just like anything else? || 2026-10-16 05:39: "But now we have compensating controls to rebuild code that is missing (right?)"
- **What the code does:** MAX_LEVEL_ROUNDS = 6 and MAX_REBUILDS = 3 (index.js:323). After 6 reports, compileLevel escalates checks_exhausted (index.js:9540). After 3 rebuilds of an orphaned contract, rebuildOrphans escalates split_failed and stops rebuilding (index.js:9190-9192). Both stop at a hold, on top of the owner's turn budget. No prompt asks for a round or rebuild cap.
- **What the owner's words require:** Repairs and rebuilds go on until done, bounded only by the budget the owner sets.
- **Votes:**
  - chrono: real. MAX_LEVEL_ROUNDS = 6 and MAX_REBUILDS = 3 (index.js:323). compileLevel escalates checks_exhausted when rounds exceed 6 (index.js:9540), and rebuildOrphans escalates split_failed after 3 rebuilds. No prompt asks for either cap. The owner said 'it should go back until done, just like anything else?' (05:54), relies on compensating controls to rebuild (05:39), and pushed back on Claude's invented call cap (00:25), with the turn budget as the bound.
  - code: real. Verified: MAX_LEVEL_ROUNDS = 6 and MAX_REBUILDS = 3 (index.js:323). checks_exhausted escalates at 9540, and rebuildOrphans escalates split_failed at 9190-9192; both end at a hold. No prompt asks for a round or rebuild cap. The owner says work goes back 'until done, just like anything else' (05:54), that there should be no stopgaps (2026-10-15 23:16), and that he doesn't understand the need for Claude's invented cap (00:25).
  - record: real. Verified: MAX_LEVEL_ROUNDS=6 and MAX_REBUILDS=3 (index.js:323). checks_exhausted fires past 6 rounds (9538-9540), and split_failed after 3 rebuilds (9190-9192), both holds. No prompt asks for these caps. The owner wants work to 'go back until done, just like anything else' (05:54), relies on compensating controls to rebuild (05:39), and called the invented call cap unneeded (00:25). Only the owner's turn budget should bound it.

### R1-chrono-14: Invented size caps on a splitter's level

- **Verdict:** confirmed (3 of 3)
- **Kind:** extra
- **Where:** `src/validations.js:22`, live in v8
- **Owner (2026-10-17 00:25):** > The 100-call cap was my own invention. ... it wasn't the question. I don't understand the need
- **What the code does:** LEVEL_LIMITS (validations.js:22) caps a level at 24 contracts and 72 validations. It also caps a check at 20 steps, 8 'has' texts, 8 input files, 300-char commands and questions, 1000-char JSON values and 4000-char stdin. Those caps are enforced in contract() and validation() (splitter.js:53,86) and in readCheck. The splitter also caps inputs at 6, labels at 70 chars and tasks at 2000 chars (splitter.js:70,112,114). The only cap the owner asked for is on children (2026-10-14 23:31: 'the manager shouldn't be allowed to have like 25 little agents'), which max_pieces covers. No prompt asks for these.
- **What the owner's words require:** Remove the caps the owner never asked for. A level's size is bounded only by what the owner set.
- **Votes:**
  - chrono: real. LEVEL_LIMITS (validations.js:22) is enforced in contract() and validation() (splitter.js:53,86) and throughout readCheck. piece() caps labels at 70 characters and tasks at 2000, and contract() caps inputs at 6. These are invented caps. The only bound the owner asked for is on a manager's children (2026-10-14 23:31), which maxPieces covers. At 00:25 he rejected a similar invented cap ('I don't understand the need').
  - code: real. Verified: LEVEL_LIMITS (validations.js:22) is 24 contracts, 72 validations, 20 steps and so on. contract() refuses at 53 and 70 (6 inputs); piece() refuses a label over 70 or a task over 2000 (112, 114); the tool text says 'Up to 6 inputs'. The only owner cap is on children (2026-10-14 23:31), which max_pieces covers. At 00:25 the owner did not see the need for the invented 100-call cap. These are extra caps that tell the splitter what it can't do.
  - record: real. Verified: LEVEL_LIMITS (validations.js:22) is enforced in contract() and validation() ('this level holds at most 24 contracts', splitter.js:53, 86). The splitter also caps inputs at 6, labels at 70 and tasks at 2000 (splitter.js:70, 112, 114). The only cap the owner asked for is on children (2026-10-14 23:31), which max_pieces covers. On Claude's self-invented call cap the owner said 'I don't understand the need'. These are 'extra' caps with no prompt behind them.

### R1-chrono-15: What Clef grades is clipped, not the original

- **Verdict:** confirmed (3 of 3)
- **Kind:** extra
- **Where:** `src/model.js:175`, live in v8
- **Owner (2026-10-16 05:12):** the model should be closer to here's the original model here's the pieces is this valid? (without going too small) || 2026-10-16 05:06: "what prompt are you giving clef and what are you giving clef to grade, exactly?"
- **What the code does:** The pre-grade and the split review cut the assignment to 2600 chars (index.js:8705,8722; model.js:130,175). The review also cuts each piece's task to 900 chars and its label to 70, and keeps only the first 24 contracts (model.js:175-176). Routing gives Clef 1800 chars of the complaint or change, 700 chars of each child's task and 16 contracts (model.js:201). The scope question gets 1800 chars of the assignment (model.js:215). matchContracts considers only the first 24 contracts (model.js:229).
- **What the owner's words require:** Clef grades the original assignment and the pieces as written, unclipped.
- **Votes:**
  - chrono: real. Owner, 05:12: Clef should see 'here's the original model / here's the pieces / is this valid?' splitStep and shouldSplit clip the assignment to 2600 characters (index.js:8705,8722; model.js:130). reviewLevel clips it to 2600 again, piece tasks to 900, labels to 70, and keeps only the first 24 contracts (model.js:175-176). routeAmong clips to 1800/700/16 and inScope to 1800, and matchContracts takes only the first 24 contracts. No prompt asks for these clips.
  - code: real. These are clips no prompt asks for, on what Clef judges. The owner's 05:12 model is 'here's the original model, here's the pieces, is this valid?'. Verified: clipEnds(prompt, 2600) for the pre-grade and the review (8705, 8722), and model.js:175 cuts the assignment to 2600, a piece's task to 900, its label to 70, and keeps 24 contracts. routeAmong cuts to 1800, 700 and 16; inScope to 1800; matchContracts takes list.slice(0,24). The splitter itself gets 4000 chars, so Clef can see less than the original.
  - record: real. Owner, 05:12: Clef should get 'here's the original ... here's the pieces ... is this valid?'. Verified: the assignment is cut to 2600 chars (model.js:130, 175; index.js:8705, 8722). The review cuts each piece's task to 900 and its label to 70 and keeps 24 contracts (model.js:175-176). Routing cuts the text to 1800, each task to 700 and the contracts to 16 (model.js:201, 215), and matchContracts keeps 24 (229). No prompt asks for these clips, and the code documents no model limit behind them.

### R1-chrono-16: v8 docs still describe the card writer, Root and hidden tests

- **Verdict:** confirmed (3 of 3)
- **Kind:** record
- **Where:** `docs/how-it-works.md:340`, not live
- **Owner (2026-10-16 05:27):** throw out the fucking card writer. You're too attached to that thing and it needs to be gone. || 2026-10-16 05:16: "no - the manager NEVER writes code." || 2026-10-16 05:54: "it should go back until done, just like anything else?"
- **What the code does:** The v8 section of docs/how-it-works.md (340-434) describes 'The card. Root's first turn turns the goal into a project card'. It says the program denylist and path rules stay, that 'An atomic Root repairs its own files', that the goal is clipped to 600 chars for workers, and that a hidden check ends benchmark_failed: 'Most tasks are atomic: Root writes the function itself' (425). docs/trying-v8.md:22 and :63 say the same ('Root's first turn writes the project card', 'Root writes the function itself'). README.md:93 says 'First the goal becomes a project card', and README.md:99 says 'with the tests hidden from every agent'.
- **What the owner's words require:** Rewrite the v8 docs to describe what the owner ruled: no card writer, managers that never write code, no hidden tests, and a grade that goes back until done.
- **Votes:**
  - chrono: real. The v8 section of docs/how-it-works.md (336-360) describes 'The card. Root's first turn turns the goal into a project card'. It also says 'the safety rules stay: ... the program denylist, path and URL rules' and gives workers the goal clipped to 600 characters. The benchmark section (424-425) describes a hidden check, benchmark_failed and 'Root writes the function itself'. trying-v8.md:22 and :63 and README.md:93 and :99 say the same. The owner ruled all of these out (05:27, 05:16, 05:39, 05:44, 05:54).
  - code: real. Verified: in docs/how-it-works.md, line 338 reads 'goal → card'. Line 340 says 'Root's first turn turns the goal into a project card'. Line 351 says the program denylist and path rules stay. Line 359 says workers get the goal clipped to 600. Lines 424-425 describe a hidden check, benchmark_failed, and 'Root writes the function itself'. trying-v8.md:22 and :63 and README.md:93 and :99 say the same. Each contradicts an owner ruling: 05:27, 05:16, 05:44, 05:39 and 05:54.
  - record: real. Verified: the v8 section of docs/how-it-works.md still describes Root's card writer (340), the program denylist and path rules (351), the goal clipped for workers (359) and the hidden check / benchmark_failed / 'Root writes the function itself' (424-425). trying-v8.md:22 and :63 and README.md:93 and :99 say the same. These contradict the owner's 05:27 (card writer gone), 05:16 (manager never writes code), 05:39 and 05:54.

### R1-chrono-17: Dashboard model hint describes the flipped split order

- **Verdict:** confirmed (2 of 3)
- **Kind:** record
- **Where:** `public/app.js:514`, live in v8
- **Owner (2026-10-16 05:09):** when did this get flipped? the idea is that manager always attempts to flip, and then clef is supposed to decide if that was a valide split
- **What the code does:** The hint shown under the model pickers reads: 'Clef scores YES/NO; the manager model proposes the split when YES, the worker model writes the code and the compiler model writes the test' (app.js:514). The static text reads: 'Clef decides YES/NO. If YES, the agent model proposes a split' (index.html:104). In v8 every manager's splitter proposes first and Clef reviews the proposal, the splitter runs on the worker model (index.js:8768), and there is no test writer. The sidebar text still says 'Start creates a new root repository' (index.html:117).
- **What the owner's words require:** The text says what the owner described: every manager attempts a split, and Clef decides whether it is valid.
- **Votes:**
  - chrono: not real. The hint (app.js:514) and the static text (index.html:104) are shared by both pipelines. They describe v7 accurately, and v7 is the default and held pipeline. The owner's 05:09 quote is about the v8 split logic, and the v8 code follows it: the splitter proposes and Clef reviews. That is stale UI copy, not drift from the owner's instruction.
  - code: real. The 05:09 quote is verbatim. Verified: app.js:514 says 'the manager model proposes the split when YES... the compiler model writes the test'. index.html:104 and :117 say 'root repository'. This hint is not pipeline-aware, so v8 rooms show it too, yet in v8 the splitter runs on the worker model (8768), there is no test writer, and root is deprecated by design (05:08). A fix that depends on the pipeline would leave the held v7 text alone. This is minor, but it is a real record error on a live v8 page.
  - record: real. Verified: app.js:514 says 'Clef scores YES/NO; the manager model proposes the split when YES ... the compiler model writes the test', and index.html:104 says the same. That is the Clef-first order the owner objected to at 05:09 ('when did this get flipped? ... manager always attempts ... then clef is supposed to decide'). v8's splitter runs on the worker model (index.js:8768), and v8 has no test writer. The hint shows for v8 rooms.

### R1-chrono-18: Bench room goal wraps the task prompt with runtime pins

- **Verdict:** confirmed (2 of 3)
- **Kind:** drift
- **Where:** `src/bench.js:166`, live in v8
- **Owner (2026-10-15 05:17):** there shouldn't be any version pinning or code type pinning or specific prompt pinning. tbh that's not prompting should work.
- **What the code does:** goalOf (bench.js:163-169) builds the room's goal as 'Complete this <Language> function and deliver it. Deliver the <Language> function f(...) in solution.py, using only the standard library. Keep the given signature...', with the task's prompt fenced inside (bench-run.js:160 starts the room with it). The grader's harness finds the entry in any .py file it walks, so the path pin is not needed to grade.
- **What the owner's words require:** A bench room's prompt is the task's own prompt, with no runtime-added language, path or library pins.
- **Votes:**
  - chrono: not real. The 2026-10-15 05:17 quote is about the system's prompts pinning versions and code types ('why it really wants to make cli apps'). It is not about a benchmark task naming its own language and entry. A HumanEval Python task is inherently Python. No owner prompt says the bench goal must be the task prompt verbatim; that is in rulings.md only. This stretches the quote.
  - code: real. Verified: goalOf (bench.js:163-169) wraps the task with 'Complete this <Language> function... Deliver ... in solution.py, using only the standard library. Keep the given signature'. The harness walks .py files (bench-harness.js:63), so the path pin isn't needed to grade. 'Only the standard library' tells the agent what it can't do (2026-10-15 15:57; 22:12 'why are packages not allowed now?'). The owner ruled out 'code type pinning or specific prompt pinning' (2026-10-15 05:17). This is the weakest of my true votes.
  - record: real. Owner, 2026-10-15 05:17, in the same burst as the benchmark request: 'there shouldn't be any version pinning or code type pinning or specific prompt pinning'. Verified: goalOf (bench.js:163-169) wraps the task with 'Deliver the <L> function ... in solution.py, using only the standard library. Keep the given signature'. The harness walks every .py/.js file (bench-harness.js:63, 179), so the path pin is not needed to grade.

### R1-chrono-19: Builder linking animation removed from the tree

- **Verdict:** confirmed (3 of 3)
- **Kind:** drift
- **Where:** `public/styles.css:135`, live in v8
- **Owner (2026-10-13 03:15):** in the tree - give the builder linking node a tiny scrolling animation left to right
- **What the code does:** Commit 6075e00 (the graph rewrite) deleted the builder's left-to-right link-sweep animation (.dot.split::after, @keyframes link-sweep). A running builder square now gets only the generic stroke pulse shared by every role (styles.css:135,138), and nothing in app.js or styles.css scrolls left to right. No later prompt withdrew the request: 2026-10-16 18:37 only made builders squares.
- **What the owner's words require:** A builder node that is linking shows a tiny left-to-right scrolling animation in the graph.
- **Votes:**
  - chrono: real. Owner, 2026-10-13 03:15: 'give the builder linking node a tiny scrolling animation left to right.' The diff of 6075e00 removes .dot.split::after and @keyframes link-sweep. styles.css now has only the generic node-pulse for running nodes (lines 135, 138), and nothing scrolls. The later prompts (18:37 squares, 18:40 Obsidian layout) do not withdraw the request.
  - code: real. Owner, 2026-10-13 03:15: 'give the builder linking node a tiny scrolling animation left to right'. Later prompts (18:37 squares, 18:40 the Obsidian layout) change the shape and the layout but don't withdraw it. Verified: git show 6075e00 deletes .dot.split::after and @keyframes link-sweep. The only animation left is the generic node-pulse (styles.css:135, 138), and app.js animate() is the force layout.
  - record: real. Owner, 2026-10-13 03:15: 'give the builder linking node a tiny scrolling animation left to right'. Verified: commit 6075e00 deleted .dot.split::after and @keyframes link-sweep. Only the generic node-pulse remains (styles.css:135-138), and nothing scrolls left to right. The 18:37 prompt only changed builder shapes and did not withdraw the request.

### R1-record-1: The splitter's role text tells it to propose no pieces, so the splitter rather than Clef decides that a level does not split

- **Verdict:** confirmed (3 of 3)
- **Kind:** drift
- **Where:** `src/prompts.js:16`, live in v8
- **Owner (2026-10-16 05:09):** the idea is that manager always attempts to flip, and then clef is supposed to decide if that was a valide split
- **What the code does:** ROLE.splitter (prompts.js:16) says: "When piece is offered, declare the fewest pieces that each fit one task, or none when the assignment is one piece of work". piece is offered only after Clef's pre-grade said the level may divide (index.js:8713, divide=room&&!caught). When the splitter then declares 0 or 1 pieces, splitStep (index.js:8726-8728) admits the level to one worker, "Its splitter proposed no pieces, so the level goes to one worker". reviewLevel is called with pieces:[] (index.js:8722), so Clef never asks split_valid. The owner also said at 05:12: "literally every manager tries to split, model can retry twice with different split parameter". The text also pushes toward "the fewest" pieces, when sizing is Clef's "without going too small" judgment (05:12).
- **What the owner's words require:** Once the pre-grade lets the level divide, the splitter proposes a division, and only Clef's review decides whether it is valid, with up to two retries. Drop "or none" and "the fewest" from ROLE.splitter, and stop admitting a 0/1-piece answer as a hand-down that bypasses Clef.
- **Votes:**
  - chrono: real. Owner, 05:09: 'manager always attempts to [split], and then clef is supposed to decide if that was a valide split'. Owner, 05:12: 'literally every manager tries to split'. The pre-grade (05:13) is the only catch. Yet ROLE.splitter (prompts.js:16) says 'declare the fewest pieces ... or none'. In splitStep, a level with fewer than 2 pieces skips split_valid (reviewLevel gets pieces:[]) and is admitted to one worker: 'Its splitter proposed no pieces'. The splitter, not Clef, decides there is no split.
  - code: real. Owner, 05:09: 'manager always attempts to [split], and then clef is supposed to decide if that was a valide split'. Owner, 05:12: 'literally every manager tries to split'. The only skip the owner set up is Clef's high-certainty pre-grade (05:13). Verified: ROLE.splitter (prompts.js:16) says 'or none when the assignment is one piece of work'. splitStep (8726-8728) admits a 0- or 1-piece answer to one worker, and reviewLevel gets pieces:[], so split_valid is never asked. The splitter, not Clef, decides that the level doesn't split. At 05:16 the owner corrected only 'manager writes code'.
  - record: real. Owner, 05:09: 'manager always attempts to [split], and then clef is supposed to decide if that was a valide split'. Owner, 05:12: 'literally every manager tries to split'. Verified: ROLE.splitter (prompts.js:16) says 'or none when the assignment is one piece of work'. When the splitter gives fewer than 2 pieces after the pre-grade allowed a division, splitStep admits the level to one worker (index.js:8726-8728), and reviewLevel gets pieces:[], so Clef never asks split_valid.

### R1-record-11: rulings.md still keeps lenient repair and safety rules 'waiting on per-check boxes'

- **Verdict:** confirmed (3 of 3)
- **Kind:** record
- **Where:** `docs/owner/rulings.md:25`, not live
- **Owner (2026-10-16 20:38):** e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it
- **What the code does:** rulings.md:25 reads "the safety rules still waiting on per-check boxes. Lenient repair (the parts of repairCard that keep meaning, such as markup to element steps) moves into src/validations.js." The owner ruled out runtime fixing of model output (above). He also ruled out blocklists (05:39) and stopgaps (2026-10-15 23:16: "no? there should be no stopgaps? ever?"). The code no longer does either (validations.js:10-12), so only the record is wrong, and it contradicts rulings.md:141.
- **What the owner's words require:** Delete the lenient-repair and safety-rules clauses from the Flow section, so the record matches the owner's rulings.
- **Votes:**
  - chrono: real. rulings.md:25 still keeps 'Lenient repair (the parts of repairCard that keep meaning...) moves into src/validations.js' and 'the safety rules still waiting on per-check boxes'. The owner ruled out runtime fixing of model output at 20:38 ('the runtime fixing it via matching or whatever') and blocklists at 05:39. rulings.md:141 contradicts line 25 in the same file. The lenient-repair clause is not covered by chrono-9.
  - code: real. rulings.md:25 still keeps 'the safety rules still waiting on per-check boxes' and 'Lenient repair ... moves into src/validations.js'. That contradicts the owner at 20:38 (no runtime fixing of the splitter's answer), at 05:39 (no blocklists) and at 2026-10-15 23:16 (no stopgaps), and it contradicts rulings.md:85-87 and :141. validations.js:10-12 confirms the code no longer does either, so only the record is wrong. The lenient-repair clause is distinct from chrono-9's path point.
  - record: real. rulings.md:25 still keeps 'the safety rules still waiting on per-check boxes' and 'Lenient repair ... moves into src/validations.js'. The owner ruled out the runtime 'fixing it via matching or whatever' (20:38) and blocklists and path rules (05:39). rulings.md:141 itself removes the lenient reading. It is a separate record error from chrono-9's code finding.

### R1-record-12: rulings.md lists 'masking of check values' as something that stays

- **Verdict:** confirmed (3 of 3)
- **Kind:** record
- **Where:** `docs/owner/rulings.md:43`, not live
- **Owner (2026-10-16 05:39):** text heuristics - I don't understand what this is for. Like architecturally, this is protecting from someting that shouldn't happen.
- **What the code does:** rulings.md:43, under "What stays, renamed", lists "masking of check values". The owner rejected the masking text heuristics (above), and at 05:49 said "The example sohuld be built from the validation". rulings.md:83-84 in the same file deletes masking. No masking code remains in src/ (grep).
- **What the owner's words require:** Remove 'masking of check values' from the list of what stays.
- **Votes:**
  - chrono: real. rulings.md:43 lists 'masking of check values' under 'What stays'. At 05:39 the owner rejected text heuristics, which Claude explained at 05:42 hid check values, and rulings.md:83 deletes masking. A grep finds no masking code in src/, so only the record is wrong, and it contradicts the owner.
  - code: real. rulings.md:43 lists 'masking of check values' under 'What stays'. Claude's 05:42 text calls that masking the text heuristics, which the owner questioned at 05:39 ('protecting from someting that shouldn't happen'). rulings.md:83-84 deletes it, and grep finds no masking left in src/. The record contradicts itself and the owner. Minor but real.
  - record: real. rulings.md:43 lists 'masking of check values' as something that stays. The owner ruled out the text heuristics (05:39), which Claude described at 05:42 as hiding check wording and values. rulings.md:83 deletes masking, and grep finds no masking left in src/. It is a record error.

### R1-record-15: CHANGELOG-v8.md puts words in quotes that the owner never wrote

- **Verdict:** confirmed (3 of 3)
- **Kind:** record
- **Where:** `CHANGELOG-v8.md:284`, not live
- **Owner (2026-10-16 05:08):** can everything here just get a base16 name? things should still be named manager or whatever, but just name it manager actually root is deprecated by design anyway, it should be manager-hex16 give boxes a hex16 name as well
- **What the code does:** CHANGELOG-v8.md:284 reads: The owner: "everything gets a base16 name… manager-hex16… root is deprecated by design", and "the manager owns the interfaces for its children… which is a file". The first turns the owner's question into a statement. The second is not in prompts.md: the owner wrote "manager (router of the system) - owns the interfaces of its children" (05:21) and "managers have to write files" (05:17), and "which is a file" appears in no owner prompt.
- **What the owner's words require:** Quote the owner's words exactly from prompts.md, or paraphrase without quotation marks.
- **Votes:**
  - chrono: real. CHANGELOG-v8.md:284 quotes the owner as 'everything gets a base16 name…' when he wrote 'can everything here just get a base16 name?' (05:08). It also quotes '...which is a file', which appears in no owner prompt; grep finds only 'manager (router of the system) - owns the interfaces of its children' (05:21). The quotation marks put words in the owner's mouth.
  - code: real. Verified: CHANGELOG:284 puts 'everything gets a base16 name' in quotation marks, but the owner asked 'can everything here just get a base16 name?' (05:08). The phrase 'which is a file' appears in no owner prompt (grep). The owner wrote 'owns the interfaces of its children' (05:21). This is a record misquote attributed to the owner.
  - record: real. Verified: CHANGELOG-v8.md:284 quotes the owner as saying "everything gets a base16 name… manager-hex16… root is deprecated by design" and "the manager owns the interfaces for its children… which is a file". prompts.md has 'can everything here just get a base16 name?' (05:08) and 'owns the interfaces of its children' (05:21), and 'which is a file' appears in no owner prompt. This misquotes the owner.

### R1-code-1: The worker still writes text blocks that the runtime parses, retries and rewrites; it has no functions

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-1
- **Kind:** drift
- **Where:** `src/model.js:722`, live in v8
- **Owner (2026-10-16 20:40):** every model should work that way, where the runtime should only be interfaces exposed to the models. not parsing the models output, but functions exposed to the models. for every model. For every interaction.
- **What the code does:** A v8 worker turn (index.js:9252 levelWorkerTurn, reached from agentTurn:7183 -> levelTurn:8878) calls decide(...,{v8:true}) -> decideV8 (model.js:722-735). decideV8 reads the free-text answer with workerAction/parseWorkerAnswer (worker-output.js:220-285). That parser reads markers leniently, closes files with no END line ('implicit_end'), falls back to JSON or a single fenced block, and reads 'true|false' as false. On a parse or control error the runtime asks the model again (model.js:727-734). index.js:9263-9268 logs format_fallback/code_retry, and index.js:9294 has rewriteFile write again any file that was cut off or listed by intent only. The worker's system text is a text format to copy (prompts.js:23-33 WORKER_FORMAT, '=== FILE: ... === / === CONTROL ==='), not a set of tools. Only the splitter uses session() function calling.
- **What the owner's words require:** Give the worker functions in a session, as the splitter has: read_file, write_file, run_examples, ask and done. The runtime only runs those calls. Remove the file-block parser, its fallbacks, the parse retry and rewriteFile from the worker path.
- **Votes:**
  - chrono: real, same as chrono-1. This is the same worker file-block parser, retry and rewriteFile issue as chrono-1, verified at model.js:722-735 and index.js:9262-9294.
  - code: real, same as chrono-1. Same issue as chrono-1, a worker answering in parsed file and control blocks, with the correct quote date (20:40). Verified.
  - record: real, same as chrono-1. The same worker block-parser, parse-retry and rewriteFile path. Quote and date (20:40) are correct, and the code is verified.

### R1-code-2: The runtime does the builder's job (renames, shape fixes, glue) and parses the link model's JSON

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-3
- **Kind:** drift
- **Where:** `src/glue.js:354`, live in v8
- **Owner (2026-10-16 20:08):** in general though - the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them. like the runtime should only be exposing functions that make other agents visible or show what the workers can do. That's it.
- **What the code does:** A v8 builder row's turn is pure runtime: levelTurn:8877 -> pieceBuilderTurn (index.js:3841) -> assemblePiece:3867 -> joinPiece:3748 -> linkPiece:3676 -> linkBundle (glue.js:354-415). linkBundle runs autoLink renames and shapeFixes, which rewrite import binding shapes in worker code (linker.js:2546). It also runs renameReferences and writeGlue, so the runtime writes the glue files. relinkBundle (index.js:4143-4177) first renames 'by the runtime' (renameFromRun). Otherwise it calls linkComponents, whose answer is a parsed JSON object of {edits, issues} (prompts.js FORMAT.linker), and applies those edits. compileLevel relinks again after a run (index.js:9477-9483). Owner, 2026-10-16 05:21: 'builder - writes glue between the interfaces created by the worker. can edit interface names'; owner, 2026-10-16 20:40: 'not parsing the models output, but functions exposed to the models'.
- **What the owner's words require:** Make the builder an agent that works through functions: read its children's files and the level file, write_file (glue), rename (interface names), done. Remove the runtime's own renames, shape fixes, glue writer and relinking, and the JSON parse of the link model's output.
- **Votes:**
  - chrono: real, same as chrono-3. This is the same issue as chrono-3: runtime renames and shape fixes, writeGlue, relinking, and the parsed JSON of linkComponents on the builder path.
  - code: real, same as chrono-3. Same issue as chrono-3: the runtime does the builder's renames, shape fixes and glue, and parses the linker's JSON. Verified in glue.js:354-415 and index.js:4143-4177.
  - record: real, same as chrono-3. The same issue: the runtime writes the builder's glue and renames, and the linker's JSON is parsed. Verified.

### R1-code-3: The runtime walks the tree and asks Clef yes/no in loops; managers have no functions

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-2
- **Kind:** drift
- **Where:** `src/index.js:9085`, live in v8
- **Owner (2026-10-16 20:43):** i mean, think about it. worker asks it manager (clef) where does it this go, clef walks up the tree to find it, which is a function
- **What the code does:** askUp (index.js:9085-9111) is called from levelWorkerTurn:9299 and routeHeld:8994. It is a runtime for-loop over ancestors, asking Clef inScope at each one with a fixed 0.5 cut. resolveAsk (9115-9130) runs matchContracts. routeComplaint (9007-9022) has the runtime pick a child by file owner, then by serves, then by all children, and asks Clef routeAmong only to break ties. routeChange (9210-9227) runs routeAmong with a 0.5 cut. Clef answers typed probabilities and is never offered functions such as children/route_to/ask_parent/answer/extend. Claude asked 'Tell me if you want that changed too', and this prompt was the owner's answer.
- **What the owner's words require:** A manager's turn is Clef choosing among functions it is offered (children, answer, route_to, ask_parent, extend). A walk is managers each calling ask_parent, not a runtime loop that asks Clef yes/no questions.
- **Votes:**
  - chrono: real, same as chrono-2. This is the same issue as chrono-2: askUp, resolveAsk, routeComplaint and routeChange are runtime loops that ask Clef yes/no questions, and Clef has no functions.
  - code: real, same as chrono-2. Same issue as chrono-2: the runtime's askUp, resolveAsk, routeComplaint and routeChange loops ask Clef yes/no questions instead of giving it functions. The quote date (20:43) is correct.
  - record: real, same as chrono-2. The same runtime routing loops (askUp/resolveAsk/routeComplaint/routeChange). Verified.

### R1-code-4: The splitter's done() refuses a level in which a contract is delivered by more than one piece, a rule the owner said Claude added

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-4
- **Kind:** drift
- **Where:** `src/splitter.js:146`, live in v8
- **Owner (2026-10-16 16:14):** you added those yourself.
- **What the code does:** The owner's line answers Claude's question whether 'one file, one owner' and 'every contract delivered by exactly one piece' should stay hard rules. missingOf (splitter.js:142-147) still adds '<name> is delivered by N pieces ...; each contract is delivered by at most one.' splitterCall 'done' (splitter.js:168-173) then keeps the level open until the splitter fixes it. This runs on every v8 split: splitStep:8714 -> runSplitter:8767 -> splitLevel. The done tool's description says the same (prompts.js:114). CHANGELOG-v8.md:356 calls it one of 'what the owner's rules still need', which attributes Claude's rule to the owner.
- **What the owner's words require:** Remove the at-most-one-piece rule from done()/missingOf and from the done tool text, so the only rule left is the owner's three examples for called or run contracts. Correct CHANGELOG-v8.md:356, which attributes the rule to the owner.
- **Votes:**
  - chrono: real, same as chrono-4. This is the same at-most-one-piece rule in missingOf and done as chrono-4.
  - code: real, same as chrono-4. Same issue as chrono-4: done() and missingOf enforce at most one piece per contract, attributed to the owner in CHANGELOG:356.
  - record: real, same as chrono-4. The same at-most-one-piece rule in done. Verified.

### R1-code-5: Bench grades go back to the room only on request (default 'once') and at most 5 times; rulings.md says they never go back

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-7
- **Kind:** drift
- **Where:** `src/bench-run.js:45`, live in v8
- **Owner (2026-10-16 05:54):** why does it not go back? it should go back until done, just like anything else?
- **What the code does:** BENCH_DEFAULTS.feedback is 'once' (bench-run.js:45). By default a failed grade settles the task and never reaches the room. With 'until_done', graded() (bench-run.js:196) sends it back only while round < MAX_GRADE_ROUNDS = 5 (bench-run.js:47) and the task timeout allows. docs/owner/rulings.md:130 still records the opposite of the owner: 'That grade never enters the room: no complaint, no event, no example.'
- **What the owner's words require:** A failed grade goes back to the room as a complaint until the room is done, as anything else does: no 'once' default and no 5-round cap. Correct rulings.md:130.
- **Votes:**
  - chrono: real, same as chrono-7. This is the same as chrono-7 (the 'once' default and the 5-round cap). The rulings.md:130 part repeats chrono-8.
  - code: real, same as chrono-7. Same issue as chrono-7, a 'once' default and a 5-round cap. It also covers rulings.md:130, which is chrono-8.
  - record: real, same as chrono-7. The same 'once' default and 5-round cap. Its rulings.md:130 part is chrono-8.

### R1-code-6: A splitter session whose context fills still holds the room at split_failed; the fresh-session change was never made

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-6
- **Kind:** drift
- **Where:** `src/index.js:8716`, live in v8
- **Owner (2026-10-17 00:55):** why didn't you just..do them?
- **What the code does:** Claude proposed two changes at 00:25 and asked 'Want me to make both changes?'. One was to drop the 100-call cap. The other: when the context fills, the splitter starts a fresh conversation with the same functions, and 'Nothing is lost, and nothing gets handed down or held.' The owner answered 'are you doing those?' (00:53) and then 'why didn't you just..do them?' (00:55). Only the cap was dropped (commit 4ae517b). session.js:66-67 still ends the session with reason 'context', and splitStep (index.js:8715-8720) escalates split_failed to the row's parent. At the top that is a room hold.
- **What the owner's words require:** When the context fills, open a new splitter session with the same functions. level() shows what is already declared, and the splitter carries on to done, with no split_failed escalation or hold.
- **Votes:**
  - chrono: real, same as chrono-6. This is the same as chrono-6: a full context still escalates split_failed, and the fresh-session change was never made.
  - code: real, same as chrono-6. Same issue as chrono-6: a full splitter context still escalates split_failed, and the fresh-session change was never made.
  - record: real, same as chrono-6. The same issue: the fresh-session change was never made, and split_failed still holds the room.

### R1-code-7: Byte-identical files after a complaint are still dropped silently and escalated

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-5
- **Kind:** drift
- **Where:** `src/index.js:9432`, live in v8
- **Owner (2026-10-16 20:06):** this should be impossiblefor the worker to do
- **What the code does:** The owner was answering exactly this: 'Unchanged files: when a worker sends a file back byte-identical, the room drops it silently and then escalates.' putFile still returns silently when the content is unchanged (index.js:5871, 'nothing changed; no commit'). The worker can still set done. compileLevel then sees the same compile_reported input and escalates checks_failed: 'The complaints ... left its files as they were' (index.js:9431-9432). At the top that is a room hold. Owner, 19:53: 'why, I keep commenting that this shouldn't happen, and the runtime keeps introducing failure cases'.
- **What the owner's words require:** Remove this runtime failure case. A worker answering a complaint cannot end in a silent no-change that escalates the room; the runtime and routing causes the owner named (19:44: '3 & 4 are issues with the runtime / routing') are fixed where they arise instead.
- **Votes:**
  - chrono: real, same as chrono-5. This is the same as chrono-5: putFile drops a byte-identical file silently, and the compile_reported check then escalates checks_failed.
  - code: real, same as chrono-5. Same issue as chrono-5: byte-identical files are dropped silently (5871) and the level escalates checks_failed (9432).
  - record: real, same as chrono-5. The same byte-identical silent drop and escalation. Verified.

### R1-code-8: The runtime polices the worker's answer: it drops files, caps and refuses asks, overrides done and adds its own notes as complaints

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-10
- **Kind:** drift
- **Where:** `src/index.js:9339`, live in v8
- **Owner (2026-10-16 20:08):** in general though - the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them.
- **What the code does:** workerAsks (index.js:9339-9361) runs on every v8 worker turn (called at 9278). It caps asks at MAX_REQUESTS = 8 (interfaces.js:307; notes at 9342-9343) and strips asks already answered (9344-9345). When the worker asks, it forces wait=true and done=false (9347) and drops every file that refers to a name the worker asked for (9349-9354, MESSAGES.wrote_before_answer). index.js:9279-9283 overrides done to false when no file was delivered. These runtime notes are saved as turn_notes (9300) and shown to the worker among its complaints (9246).
- **What the owner's words require:** Expose functions only (ask, write_file, done). The worker's own calls decide what is written and when it is done: no dropped files, ask cap, forced wait or done, and no runtime notes mixed into its complaints.
- **Votes:**
  - chrono: real, same as chrono-10. This is the same as chrono-10: workerAsks caps and filters asks, drops files and forces wait and done, and done is flipped on delivered_nothing.
  - code: real, same as chrono-10. Same issue as chrono-10: workerAsks caps and filters asks, drops files and forces done, and the runtime notes go into turn_notes.
  - record: real, same as chrono-10. The same runtime policing of the worker's answer. Verified, including turn_notes being mixed into complaints (index.js:9246).

### R1-code-9: Path rules still refuse agents' writes and contracts, and hidden-file paths cause a hold for the person

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-9
- **Kind:** drift
- **Where:** `container/build-path.mjs:26`, live in v8
- **Owner (2026-10-16 05:39):** there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- **What the code does:** Every v8 worker file passes through pathError(path,{own:true}) (index.js:9272-9277, also putFile:5838-5842). It refuses any name outside [A-Za-z0-9_.-] ('use only letters, digits, '_', '-' and '.' ... rename the file'), '.git' and long names, and tells the worker 'Not written: ...' (MESSAGES.not_written). joinPiece skips the same paths (index.js:3775). The splitter's contract() calls nameError, which refuses paths under the reserved RUNTIME_PREFIXES components/, memory/, .recursive/, glue/ (contracts.js:30, 333). urlPathError refuses '..', '//' and %2e/%2f/%5c in check paths (validations.js:61-66). buildPathError leaves dotfiles out of the box (index.js:3683-3684), and the compiler then holds checks_untested for the person (9407-9413). rulings.md:25 still lists 'paths' and 'the safety rules' as runtime hard rules. Owner, 2026-10-15 15:57: 'I never want to tell an agent what they can't do'.
- **What the owner's words require:** Remove the path rules on agents. Each agent's world is its own repository and its box, so a path is just a file in that world and is never refused or held. Correct rulings.md:25.
- **Votes:**
  - chrono: real, same as chrono-9. This is the same as chrono-9: the worker's pathError refusal, the RUNTIME_PREFIXES refusal and rulings.md:25.
  - code: real, same as chrono-9. Same issue as chrono-9: path rules in pathError, nameError and urlPathError, plus rulings.md:25.
  - record: real, same as chrono-9. The same path rules on agents. Verified.

### R1-code-10: The split bar rises with depth, so managers at different levels are judged by different rules

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-11
- **Kind:** drift
- **Where:** `src/index.js:858`, live in v8
- **Owner (2026-10-15 22:22):** yeah, I want all of the managers to be exactly the same.
- **What the code does:** splitBar (index.js:858) returns the room's split_valid_bar only at depth 0-1. Deeper managers get t+(0.95-t)*min(d-1,h)/h, rising toward 0.95. splitStep uses it to admit or retry every v8 division (index.js:8730), so a deeper manager needs a higher Clef p for the same split. CHANGELOG-v8.md:273 records this as 'rising with depth as the old gate's bar did'. Owner, 2026-10-16 05:12: 'literally every manager tries to split'.
- **What the owner's words require:** Apply one split_valid_bar to every manager, whatever its depth, so every level is judged the same way.
- **Votes:**
  - chrono: real, same as chrono-11. This is the same as chrono-11: splitBar rises with depth.
  - code: real, same as chrono-11. Same issue as chrono-11: splitBar rises with depth.
  - record: real, same as chrono-11. The same depth-rising split bar.

### R1-code-11: Caps no prompt asked for: repair rounds, rebuilds, complaints per report and the splitter's level sizes

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-13
- **Kind:** extra
- **Where:** `src/index.js:323`, live in v8
- **Owner (2026-10-16 05:54):** it should go back until done, just like anything else?
- **What the code does:** MAX_LEVEL_ROUNDS = 6 (index.js:323): after six reports, compileLevel escalates checks_exhausted (9538-9540), a room hold at the top. MAX_REBUILDS = 3: rebuildOrphans escalates split_failed after three rebuilds (9190-9195), although the owner's rule is that compensating controls rebuild what is missing (05:39: 'now we have compensating controls to rebuild code that is missing'). MAX_PROBLEMS_PER_REPORT = 12 (problems.js:24) drops any complaint past twelve (index.js:9544). LEVEL_LIMITS (validations.js:22: 24 contracts, 72 validations) and splitter.js:71/112/114 (6 inputs, 70-character label, 2000-character task) refuse the splitter's calls. No prompt asks for any of these. At 2026-10-17 00:25 the owner answered Claude's own invented 100-call cap with 'I don't understand the need'.
- **What the owner's words require:** Remove these runtime caps and the complaint clip: work goes back until done, bounded only by the turn budget the owner sets, and every complaint reaches its worker.
- **Votes:**
  - chrono: real, same as chrono-13. This bundles caps already reported. MAX_LEVEL_ROUNDS and MAX_REBUILDS are chrono-13, MAX_PROBLEMS_PER_REPORT is in chrono-12, and LEVEL_LIMITS and the piece and contract caps are chrono-14. All are verified.
  - code: real, same as chrono-13. It combines chrono-13 (MAX_LEVEL_ROUNDS, MAX_REBUILDS), chrono-12 (the 12-complaint cap) and chrono-14 (LEVEL_LIMITS and the splitter caps). All verified, but none of it is new.
  - record: real, same as chrono-13. It overlaps chrono-13 (round and rebuild caps), chrono-14 (LEVEL_LIMITS and splitter argument caps) and chrono-12 (MAX_PROBLEMS_PER_REPORT). Each part is verified.

### R1-code-12: how-it-works.md's v8 section still describes the card writer, a program denylist, path rules, a hidden bench check and a tamper scan

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-16
- **Kind:** record
- **Where:** `docs/how-it-works.md:338`, not live
- **Owner (2026-10-16 05:27):** throw out the fucking card writer. You're too attached to that thing and it needs to be gone.
- **What the code does:** Under '## v8 (experimental)', 'How a v8 run goes' (docs/how-it-works.md:336-351) starts with the card writer and lenient card reading, and says 'the safety rules stay: argv-only commands, the program denylist, path and URL rules, base files and hidden requirements'. Line 418 keeps 'the card's command rules'. Lines 424-425 describe the bench card with 'one hidden command check', 'benchmark_failed' and 'pass@1 with no test feedback'. Line 430 says the harness 'scans the solution for constructs that tamper with the interpreter'. The owner ruled out all of these: no card writer (05:27), the tamper scan ('wtf? that's inferrior', 2026-10-15 15:55), blocklists and path rules (2026-10-16 05:39), and a grade that never goes back (2026-10-16 05:54).
- **What the owner's words require:** Rewrite the v8 section of docs/how-it-works.md to match the owner's rulings: no card or card writer, no denylist or path rules, no hidden checks or tamper scan, and benchmark grades that go back to the room until done.
- **Votes:**
  - chrono: real, same as chrono-16. This is the same as chrono-16: the v8 section of how-it-works.md still describes the card writer, the denylist and path rules, the hidden bench check and the tamper scan (lines 338-430).
  - code: real, same as chrono-16. Same issue as chrono-16, the stale v8 section of how-it-works.md. The tamper-scan line (430) is an extra detail.
  - record: real, same as chrono-16. The same stale v8 docs. Its tamper-scan point (how-it-works.md:430) is verified stale too: bench-harness.js has no scan.

### R1-record-2: done() enforces 'each contract delivered by at most one piece' and calls it an owner rule; the owner said Claude added it

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-4
- **Kind:** drift
- **Where:** `src/splitter.js:144`, live in v8
- **Owner (2026-10-16 16:14):** you added those yourself.
- **What the code does:** The owner gave this answer to Claude's question "Should 'one file, one owner' and 'every contract delivered by exactly one piece' stay hard rules, or become something Clef judges in its split review?". missingOf (splitter.js:144-147) still refuses done with "X is delivered by N pieces ...; each contract is delivered by at most one", and done stays open (splitter.js:164-166). The model reads this rule in the done tool description (prompts.js:114). The rule is attributed to the owner in the splitter.js header (lines 5-7, "once the owner's rules hold ... each contract delivered by at most one piece"), missingOf's comment ("What the owner's rules still need"), and CHANGELOG-v8.md:356. test/splitter.test.js:147 pins it. CHANGELOG-v8.md:310 had already recorded that "the runtime rejects none of them"; the functions slice brought the rule back.
- **What the owner's words require:** Remove the at-most-one-piece check from missingOf and from the done description. done requires only the owner's three different examples per called or run contract. Delivered-by-several stays a fact in Clef's split review (divisionOf), and nothing calls it an owner rule.
- **Votes:**
  - chrono: real, same as chrono-4. This is the same as chrono-4: missingOf's at-most-one-piece rule is attributed to the owner in the splitter.js header, the done tool text and the changelog, and pinned by a test.
  - code: real, same as chrono-4. Same issue as chrono-4. Its added evidence (the splitter.js header and CHANGELOG:310) is verified.
  - record: real, same as chrono-4. The same rule. It adds that the splitter.js header comment calls it the owner's rule, which is verified at lines 5-7.

### R1-record-3: A splitter whose context fills is held as split_failed, and its calls are not counted against the turn budget, though the owner told Claude to make both proposed changes

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-6
- **Kind:** drift
- **Where:** `src/index.js:8719`, live in v8
- **Owner (2026-10-17 00:55):** why didn't you just..do them?
- **What the code does:** Claude proposed two changes (quoted in the owner's 2026-10-17 00:25 message): "when the context fills, the splitter starts a fresh conversation with the same functions. level() shows it everything it has already declared ... nothing gets handed down or held", and "count each call against the room's turn budget". The owner replied "are you doing those?" (00:53) and "why didn't you just..do them?" (00:55). session.js:66-67 still ends the session with reason 'context'. splitStep (index.js:8716-8720) then escalates split_failed, which holds the room for the person. spendsTurn (index.js:7886-7894, spent++ at 8014) charges one turn per split step whatever the number of calls (live 9 had 193 calls in one session). Only the 100-call cap was dropped (commit 4ae517b). The records describe this as intended: session.js:14-15, CHANGELOG-v8.md:355 and :358 ("A session that ends without done escalates split_failed"). test/v8-levels.test.js:150-158 pins the hold.
- **What the owner's words require:** When the context fills, start a fresh splitter session with the same functions and the stored state, so level() shows what has been declared, and continue until done, with no hold or hand-down. Count each function call against the room's turn budget. Update session.js, the changelog and the v8-levels test to match.
- **Votes:**
  - chrono: real, same as chrono-6. This is the same as chrono-6: a full context gives split_failed, and calls are not counted against the turn budget (spendsTurn charges one turn per split step).
  - code: real, same as chrono-6. Same issue as chrono-6, including the per-call turn budget. spendsTurn (7886-7894) and session.js:66-67 are verified.
  - record: real, same as chrono-6. The same issue, covering both changes. spendsTurn and spent++ (index.js:7886-7894, 8014) are verified.

### R1-record-4: Workers, the file rewriter and the linker still answer in free text that the runtime parses, with fallbacks and retries

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-1
- **Kind:** drift
- **Where:** `src/prompts.js:26`, live in v8
- **Owner (2026-10-16 20:40):** every model should work that way, where the runtime should only be interfaces exposed to the models. not parsing the models output, but functions exposed to the models. for every model. For every interaction.
- **What the code does:** FORMAT.worker (prompts.js:26-35) tells the worker to write '=== FILE: ... === / === END FILE === / === CONTROL ===' blocks, and ROLE.worker (prompts.js:17) says to "ask for it in your control block". levelWorkerTurn (index.js:9262) calls decide(v8), and decideV8 (model.js:722-735) parses this with workerAction, retrying when the control block is malformed. The room logs format_fallback, code_retry, implicit_end and control_error (index.js:9265-9268), and rewrites cut files with a separate model call, rewriteFile, under ROLE.file/FORMAT.file (index.js:9294, model.js:743-754, singleFileText). The v8 linker (FORMAT.linker, prompts.js:40) answers one JSON object, which linkComponents parses with parseObject and retries (model.js:803-811); relinkBundle reaches it (index.js:4164). Only the splitter uses session().
- **What the owner's words require:** Give the worker functions through session(): read_file, write_file, ask and done. Give the builder functions too: read files and the design artifact, write_file, rename and done. Delete the block and control parsers, the format fallbacks, code_retry, rewriteFile/ROLE.file, and the JSON parsing of the linker.
- **Votes:**
  - chrono: real, same as chrono-1. This is the same as chrono-1 (the worker's file and control parsers, rewriteFile). Its linker JSON parse part is covered by chrono-3.
  - code: real, same as chrono-1. Same issue as chrono-1, with the linker JSON parsing also covered by chrono-3. Verified.
  - record: real, same as chrono-1. The same issue: the worker and file-rewriter answer in parsed text. The linker JSON parse it adds is covered by chrono-3.

### R1-record-5: The builder's role text allows renames only, and the runtime writes the glue itself; the owner said the builder writes glue

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-3
- **Kind:** drift
- **Where:** `src/prompts.js:19`, live in v8
- **Owner (2026-10-16 05:21):** builder - writes glue between the interfaces created by the worker. can edit interface names
- **What the code does:** ROLE.linker (prompts.js:19) says: "make files ... refer to each other correctly, by changing only names and reference paths ... Anything a rename cannot fix, report as an issue". The v8 builder is a runtime row (pieceBuilderTurn, index.js:3841). linkBundle writes the glue (glue.js:16-27: "A row with glue (Python) gets runtime-written files ... a shim at the bundle root ..., a package marker ..."). It also renames by folding case, '_' and '-' to a canonical match. relinkBundle's renameFromRun renames at runtime first and asks the model only after that fails (index.js:4153-4155). docs/how-it-works.md:360 states "The runtime writes the glue; a model never does". The owner also said at 20:08: "the runtime shouldn't be ... doing any of the agents work for them".
- **What the owner's words require:** The builder is the agent that writes the glue between the workers' interfaces and may rename interface names. Its text and its functions (write_file for glue, rename) must allow that. The runtime's glue writer and canonical-match renames go.
- **Votes:**
  - chrono: real, same as chrono-3. This is the same as chrono-3. The rename-only builder text (ROLE.linker) and the runtime writing the glue (glue.js:16-27, how-it-works.md:360) contradict 'builder - writes glue'.
  - code: real, same as chrono-3. Same issue as chrono-3: the builder doesn't write glue and the runtime does. ROLE.linker allowing renames only and how-it-works:360 are verified.
  - record: real, same as chrono-3. The same issue. Its extra points (ROLE.linker allows renames only, how-it-works.md:360 'The runtime writes the glue') are verified and belong to the same fix.

### R1-record-6: Routing is a loop the runtime runs, asking Clef yes/no at each level; Clef has no functions

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-2
- **Kind:** drift
- **Where:** `src/index.js:9094`, live in v8
- **Owner (2026-10-16 20:43):** i mean, think about it. worker asks it manager (clef) where does it this go, clef walks up the tree to find it, which is a function
- **What the code does:** askUp (index.js:9085-9111) is a runtime for-loop up agentAbove() that asks inScope (CLEF.owns_need) at each manager and stops at the first p>=0.5. resolveAsk (9115-9130) asks matchContracts (CLEF.match). routeComplaint (9007-9022) picks targets by runtime rules: parties' owners, then serves, then "to=kids" (any live child, line 9013). It asks routeAmong (CLEF.owner) only when there are several targets. routeChange (9210-9227) works the same way with CLEF.change. None of these give Clef a session or functions. These are the paths Claude offered to leave as they were ("I left Clef as it is ... Tell me if you want that changed too"), and the owner's reply is quoted above.
- **What the owner's words require:** A manager's turn is Clef choosing among functions: children(), answer(contract), route_to(child), ask_parent(need), extend(need). A walk up the tree is a chain of ask_parent calls. The runtime runs no walk loop, no yes/no polling, and no any-child fallback.
- **Votes:**
  - chrono: real, same as chrono-2. This is the same as chrono-2: runtime routing loops that ask Clef yes/no, with an any-child fallback.
  - code: real, same as chrono-2. Same issue as chrono-2: the runtime routing loops.
  - record: real, same as chrono-2. The same issue. The code at index.js:9013 (to=kids fallback) and the 0.5 cut are verified.

### R1-record-7: Path rules on agents: a worker's file is refused for its name characters, memory/ files are dropped, splitter contracts are kept out of runtime folders, and agents are told which paths not to change

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-9
- **Kind:** drift
- **Where:** `src/index.js:9274`, live in v8
- **Owner (2026-10-16 05:39):** there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- **What the code does:** levelWorkerTurn runs every worker file through pathError(f.path,{own:true}) (index.js:9272-9277). That refuses any name outside [A-Za-z0-9_.-] and any '.git' segment (container/build-path.mjs:34-35), and tells the worker "Not written: ... use only letters, digits ... rename the file" (MESSAGES.not_written). Files under memory/ are dropped silently (index.js:9273). The splitter's contract() refuses paths under components/, memory/, .recursive/ and glue/ (contracts.js:333, RUNTIME_PREFIXES at contracts.js:30). MESSAGES.base_note, read by workers and splitters, says "Change one only when your prompt names its path" (prompts.js:171). The owner also said on 2026-10-15 15:57: "in general I never want to tell an agent what they can't do".
- **What the owner's words require:** Agents get no path rules. A worker's files exist in its own repo, and only the paths the design places reach anyone else, as the owner set out. Remove the refusal, the memory/ drop, the runtime-prefix refusal and the 'change only when...' wording.
- **Votes:**
  - chrono: real, same as chrono-9. This is the same as chrono-9: pathError on worker files, the memory/ drop and the RUNTIME_PREFIXES refusal.
  - code: real, same as chrono-9. Same issue as chrono-9. base_note's 'Change one only when your prompt names its path' (prompts.js:171) is verified as an extra detail.
  - record: real, same as chrono-9. The same path rules. It adds MESSAGES.base_note ('Change one only when your prompt names its path', prompts.js:171), which is verified and covered by the same fix.

### R1-record-8: The worker's turn enforces process: an ask cap, files dropped when they use an asked name, done refused, and runtime notes delivered as complaints

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-10
- **Kind:** extra
- **Where:** `src/index.js:9339`, live in v8
- **Owner (2026-10-16 20:08):** in general though - the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them. like the runtime should only be exposing functions that make other agents visible or show what the workers can do. That's it.
- **What the code does:** workerAsks (index.js:9339-9360) sends only the first MAX_REQUESTS=8 asks (interfaces.js:307; MESSAGES.ask_limit). It drops any file that refers to a name the worker is asking for (MESSAGES.wrote_before_answer, prompts.js:175). It forces wait=true and done=false, and cancels a wait when no ask is open (MESSAGES.no_request, MESSAGES.ask_unclear). levelWorkerTurn sets done=false when no file was delivered (index.js:9279-9283, MESSAGES.delivered_nothing). The worker's own files are clipped to a budget, and FORMAT.worker tells it to "leave it as it is" (prompts.js:34, sentFiles). These runtime notes reach the worker mixed into its complaints (turn_notes, index.js:9246). No prompt asks for an ask cap, file dropping, a done gate or clipping a worker's own files.
- **What the owner's words require:** Remove these rules. The worker's functions report what exists and store what it writes, and its complaints are only what the compiler observed, verbatim.
- **Votes:**
  - chrono: real, same as chrono-10. This is the same as chrono-10 (workerAsks' cap, dropped files, the done gate and runtime notes). The clipped-file part repeats chrono-12.
  - code: real, same as chrono-10. Same issue as chrono-10 (worker process enforcement). The clipping of the worker's own files overlaps chrono-12.
  - record: real, same as chrono-10. The same worker-turn process rules. Its clip of the worker's own files is also covered by chrono-12.

### R1-record-9: The benchmark grade goes back to the room only if a non-default option is chosen, and then at most 5 times

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-7
- **Kind:** drift
- **Where:** `src/bench-run.js:45`, live in v8
- **Owner (2026-10-16 05:54):** why does it not go back? it should go back until done, just like anything else?
- **What the code does:** BENCH_DEFAULTS.feedback is 'once' (bench-run.js:45, also the UI default at public/app.js:721), and with 'once' a failed grading is final and never reaches the room. The grade is sent back as a complaint only with 'until_done', and then only while round < MAX_GRADE_ROUNDS = 5 (bench-run.js:47, 196).
- **What the owner's words require:** A failed grading goes back to the room as a complaint and the room runs again until it passes, as any complaint does. That is the behaviour, not an option. Remove the invented 5-round cap.
- **Votes:**
  - chrono: real, same as chrono-7. This is the same as chrono-7: the 'once' default and MAX_GRADE_ROUNDS = 5.
  - code: real, same as chrono-7. Same issue as chrono-7, the bench 'once' default and the 5-round cap.
  - record: real, same as chrono-7. The same bench feedback default and cap. Verified.

### R1-record-10: rulings.md says the benchmark grade never enters the room, the opposite of what the owner said

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-8
- **Kind:** record
- **Where:** `docs/owner/rulings.md:130`, not live
- **Owner (2026-10-16 05:54):** why does it not go back? it should go back until done, just like anything else?
- **What the code does:** rulings.md:130 reads "When the room is done, the BenchRun grades the shipped bundle once ... That grade never enters the room: no complaint, no event, no example." This repeats Claude's proposal (quoted in the owner's 05:54 message), which the owner rejected in that same message.
- **What the owner's words require:** Record the owner's ruling: the grade goes back to the room until done, like any other complaint.
- **Votes:**
  - chrono: real, same as chrono-8. This is the same as chrono-8: rulings.md:130 says the grade never enters the room.
  - code: real, same as chrono-8. Same issue as chrono-8, rulings.md:130.
  - record: real, same as chrono-8. The same rulings.md:130 misrecord.

### R1-record-13: The v8 section of docs/how-it-works.md still describes the card writer, the denylist, runtime-only glue, and workers that read the goal

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-16
- **Kind:** record
- **Where:** `docs/how-it-works.md:340`, not live
- **Owner (2026-10-16 05:27):** throw out the fucking card writer. You're too attached to that thing and it needs to be gone.
- **What the code does:** how-it-works.md:338-340 says "The forward path is goal → card ... Root's first turn turns the goal into a project card". Line 351 says "the safety rules stay: argv-only commands, the program denylist, path and URL rules". Line 359 says "A worker sees ... the project facts, and the goal clipped to 600 characters as a scope limit". Line 360 says "v8 has no compiler agent ... The runtime writes the glue; a model never does", and line 414 describes masked failure details. docs/trying-v8.md:22-53 likewise walks through the Project card. Each statement contradicts an owner prompt: the card (05:27), worker goal and siblings (05:44, "the workers shouldn't know about their siblings. or about the overall project goal."), no blocklists (05:39), and the builder writes glue (05:21).
- **What the owner's words require:** Rewrite the v8 sections of both docs to the owner's rulings: no card or prompt handler, the splitter's functions, a worker that gets only its prompt, its files and its complaints, a builder that writes glue, and no denylist or path rules.
- **Votes:**
  - chrono: real, same as chrono-16. This is the same as chrono-16: the v8 docs still describe the card, the denylist, runtime-only glue and the 600-character goal for workers.
  - code: real, same as chrono-16. Same issue as chrono-16, the stale v8 docs in how-it-works.md and trying-v8.md.
  - record: real, same as chrono-16. The same stale v8 docs (how-it-works.md and trying-v8.md).

### R1-record-16: Invented caps on a splitter's level (24 contracts, 72 validations, 6 inputs, 70-character labels, 2000-character tasks, 20 steps)

- **Verdict:** confirmed (3 of 3), same issue as R1-chrono-14
- **Kind:** extra
- **Where:** `src/validations.js:22`, live in v8
- **Owner (2026-10-14 23:31):** i feel like the manager shouldn't be allowed to have like 25 little agents
- **What the code does:** LEVEL_LIMITS (validations.js:22) caps a level at 24 contracts and 72 validations, a check at 20 steps, and has-texts at 8, among other limits. The splitter's functions refuse calls past them: contract() at splitter.js:53 ("this level holds at most 24 contracts") and :70 ("up to 6 inputs", also in the tool text at prompts.js:98), validation() at :86, and piece() at :112 (label ≤70) and :114 (task ≤2000). The quoted prompt is the only one where the owner asked for a cap, and it bounds a manager's children, which maxPieces already does. No prompt caps contracts, validations, inputs, labels, task lengths or steps. When Claude described the 100-call cap as "my own invention", the owner replied "I don't understand the need" (2026-10-17 00:25).
- **What the owner's words require:** Keep only the owner's bound on a manager's children (maxPieces/max_children). Remove the other level and argument caps from LEVEL_LIMITS, the splitter's functions and the tool descriptions.
- **Votes:**
  - chrono: real, same as chrono-14. This is the same as chrono-14: invented LEVEL_LIMITS and caps on the splitter's functions.
  - code: real, same as chrono-14. Same issue as chrono-14, LEVEL_LIMITS and the splitter's argument caps.
  - record: real, same as chrono-14. The same invented level and argument caps.

### R1-record-14: CHANGELOG-v8.md never records the owner's 2026-10-16 rulings, so its last word is that workers get the goal and shared principles

- **Verdict:** rejected (0 of 3)
- **Kind:** record
- **Where:** `CHANGELOG-v8.md:61`, not live
- **Owner (2026-10-16 05:47):** shared...princples...after I say "agents shouldn't know that any other agents exist...over...and over...and over...again. What the fuck is the point of a principles file
- **What the code does:** CHANGELOG-v8.md:59 says every prompt is "a short set of shared principles, then a role paragraph", and :61 says "workers get the goal as a scope limit". B1 (:67) says the harness "scans for tampering", and :177/:181 describe the prompt handler and the card writer as current. No later section records that the card writer, the prompt handler and PRINCIPLES were deleted, that the worker's input was rewritten (no goal or siblings, examples built from validations), or that masking and the tamper scan were removed. The code has none of these (prompts.js has no PRINCIPLES, workerView has no goal, a grep for tamper finds nothing).
- **What the owner's words require:** Add an entry for the owner's 2026-10-16 rulings saying what was removed: the card writer, the prompt handler, PRINCIPLES, the goal and siblings in a worker's input, masking, the tamper scan and hidden checks. Readers then no longer take the stale slices as current.
- **Votes:**
  - chrono: not real. CHANGELOG-v8.md:59, :61 and :67 describe what the S6 and B1 slices did at the time, and that history is accurate. The code already honours the owner: there is no PRINCIPLES, no goal in workerView and no tamper scan. A missing changelog entry does not say something the owner didn't, and no owner prompt asks for one. It contradicts no owner instruction.
  - code: not real. The changelog's S6 and B1 entries are an accurate history of what was built then, and they attribute nothing to the owner. A missing entry for later removals is a gap in the documentation, not a contradiction of an owner instruction, and no owner prompt asks for a changelog entry. The fix doesn't follow from the owner's words.
  - record: not real. CHANGELOG-v8.md:59, :61 and :67 are history entries that were true when written (S6, B1). The code complies: there is no PRINCIPLES and no goal in workerView. An entry that is missing is an omission, not a record that says something the owner didn't, and the fix (add an entry) does not follow from the owner's words. The stale current-state docs are covered by chrono-16.
