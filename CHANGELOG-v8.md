# v8: the goal defines what gets built and how it's checked

v7 builds one shape of thing: a JavaScript module graph whose entry exports `start()`, tested by a script a model writes after the code exists. Goals like "add a README to this repo" or "a to-do list web page" had nowhere to go. An audit of the code found the shape fixed in three places (what a piece can promise, what the linker can join, and how the result is tested), plus seven separate gates that rejected Markdown or HTML outright, and no way to start from an existing repo.

v8 is a second pipeline, chosen per room. v7 stays the default and is unchanged. Everything below was built in slices, each reviewed and fixed before merging, and tested offline with scripted models and the real Container scripts run in Node. **No live run has used v8 yet.** [docs/trying-v8.md](docs/trying-v8.md) is the checklist for the first ones.

The slices are listed in the order they landed.

## Speed v1

Two exported runs set the targets. On the small issue tracker run (340 s), compiles took 52% of the wall clock, because every compile ran the Container twice on the smallest instance. On an 807-agent run, contract send-backs after the commit cost 19% of all turn-seconds, and 87 of them were for the `await` rule alone.

- **Spans.** Every model call, Clef gate, git phase, Container run and dispatch is recorded with its timing, tokens when the model reports them, and the agent it was for. The export now streams every event and span instead of stopping at 20,000.
- **One Container exec per compile**, with all syntax checks in one Node process, on a `standard-1` instance (1/2 vCPU, 4 GiB) that is pre-warmed just before a compile.
- **Contract check before the commit.** A missing `await` is fixed mechanically when it is unambiguous, anything else gets one correction call inside the same turn, and only what is still wrong is sent back after the commit.
- **Per-model settings in one table**, with each model's own recommended sampling.
- **The dashboard polls a delta every second** (`/api/delta`) instead of the full snapshot every 3 s, which was 1.1 MB on the large run.

The review changed four things. The `await` fix used to make the enclosing function async, which broke callers in other files, so now it only adds `await` inside functions that are already async, and only for callees known to be async. The merged exec ran `start()` in the same folder as the test, leaking its side effects, so `start()` now runs in a throwaway copy. Sampling follows the vendor only where the vendor's own card was checked; the other models keep 0.2. The idle timeout went back from 300 s to 120 s, a pre-warmed Container that gets no compile within 60 s is stopped, and INSTALL-CLOUDFLARE.md explains the cost.

## S1: workers write any text file

The JavaScript-only and anti-prose gates are gone. Any non-empty text file passes, `.json` must parse, and JavaScript keeps its Acorn parse. Workers answer in raw file blocks (`=== FILE: path ===` … `=== END FILE ===`) instead of code escaped inside JSON.

The review found that a `.gitignore` or a file name with a space got through the gate and then stopped the compile for good, and that a stray `package.json` with `"type":"module"` could break a branch's CommonJS. Now one path rule is shared by the gate, the build and the Container, manifests are refused unless a contract places them, and a piece promising code has to deliver code, not just notes.

## S2: language-neutral contracts

A v7 promise was a JavaScript function name. A contract can be a function, file, page, route, command, doc or data file, with inputs, outputs, effects and examples. Each contract carries `serves`: the ids of the requirements it helps meet, inherited down the split. That is the map a failed check is routed back along. A v7 promise reads as a function contract with nothing lost.

The review found an infinite loop in `serves` inheritance, and that a v7 model answer with a `kind` field could change v7 admission. Every v8 key is now gated on an explicit v8 flag, a model can't set `serves` itself, and v7 answers parse as they did before (136 probe cases, no differences).

## S3: the project card and the pipeline setting

In a v8 room, Root's first act is to turn the goal into a project card: languages, deliverables, how to run them, and requirements, each with one declarative check. Clef vets every requirement against the goal, and a goal needing a language the Container doesn't have stops at `card_blocked` before any split. The dashboard gets the Pipeline select and a Project card panel.

The review showed that checking only a command's first word is not a safety boundary (shell chaining, `-c`, `npx`), and that browser and HTTP paths like `//host` or `\` could reach another host. Commands are now argv from a strict tokenizer with no shell syntax, paths must start with a single `/`, a Clef error keeps the card instead of rerunning the writer, and the card writer's token budget went up to 8,192 because reasoning was using up the 3,000-token cap.

## S4a: the Container runs a card's checks

One exec runs syntax per language, the project's own test commands, the servers a check needs, then command, function-call, HTTP and browser checks. Every check runs even after one fails. The image gains Python 3 with pytest and Playwright's Chromium headless shell, on the Node LTS channel.

The review found three ways to cheat or break this. A module could read the nonce that marks a genuine pass, so the Python adapter is now a supervisor that never imports the module under test. A command check could rewrite the bundle that later checks used, so every check now gets its own fresh copy. A `setsid` child could escape the kill, so process trees are tagged and killed by tag. Chromium is also fenced to the served host, and check processes run under `prlimit`. The review also set the rule the next slices follow: no model ever sees a check's arguments or expected values, because a module that knows them can just return them.

## S8a: fetcher and repo reader

These are pure modules, wired into the room only in S8b. The fetcher reads only `https://` links written in the goal, from hosts on an owner allowlist, with manual redirects rechecked at every hop, no credentials and capped bodies. Fetched text is sanitised and quoted as data. The repo reader takes a public GitHub repo without a token.

Two security reviews shaped it. `DecompressionStream` has no backpressure in workerd, so a 120 KB gzip body could grow to about 180 MB in memory; it was replaced by a small inflater that only decodes when its reader asks. The HTML-to-text scanner had quadratic and cubic backtracking and became one linear tokenizer that fails closed on hidden content. `fetch` now gets the URL that was validated, never the raw string.

## S4b: the room runs the checks and routes failures

When the tree finishes, the room bundles the files and runs the card's checks: file checks in the Worker, Clef for documents, and everything else in one Container exec. Each failed requirement becomes a problem routed by `serves` to the piece that owns it. A check that has passed once is anchored and never changed. The export carries `.recursive/RUN.md` and `.recursive/card.json`, and the project's own README is never written.

The review found that check arguments and expected values were reaching workers twice: through contract examples, and through failure details a regex cut before masking. Now contracts carry only examples the card writer gave, the Container reports observed values separately from expected ones, and the worker's text is masked against every check value before any clipping. A Clef error while judging is retried before the room is held, and a `checks_blocked` hold retries itself on an alarm.

## S6: the prompt rewrite

Every v8 prompt lives in `src/prompts.js` as data: a short set of shared principles, then a role paragraph and an output format for each role. No prompt names a language, framework or goal domain. The project's languages and reference lines reach a model only in the user JSON. v7 requests are byte-identical, which was checked by capturing every call.

The review found v7 texts still reaching v8 workers ("container build", "export", "Qwen"), and `require()` offered to static browser pages. Every text the room writes for a v8 agent is now in `MESSAGES`, browser projects refer to ES module files, workers get the goal as a scope limit, and a lint test checks the texts that actually reach models, not just the templates.

## B1: benchmark mode

`/api/bench` and a Benchmarks panel run HumanEval, MBPP, MultiPL-E (JS and Python) or plain `{id, prompt, tests}` JSON lines, one v8 room per task. Each room gets a card fixed by the benchmark: one function deliverable and one hidden check that runs the benchmark's tests. A `BenchRun` Durable Object drives the rooms on alarms, so a run continues with the page closed.

The review's first finding was that, on that branch, the hidden checks never ran at all, so it was merged with S4b. Then it broke the harness in several ways (patching `exec`, reading the nonce from a frame, replacing `Function` or `Module._load`). The harness is now a supervisor that never loads the solution: it scans for tampering, runs the tests in a separate process without the nonce, counts its assertions, and checks afterwards that nothing it relies on was replaced. Every probe forgery fails, and the reference solutions pass 164/164 on HumanEval and 427/427 on sanitized MBPP. Platform failures score as errors rather than misses, Stop beats a tick in flight, and rooms share an executor pool capped by `BENCH_EXECUTORS`.

## S5: linking other languages

The linker still never writes logic. JavaScript keeps its rename-only builder. For Python, the runtime writes the glue (root shims, package markers, a module path only where needed), and a reference that resolves nowhere is renamed to the one contract name it matches. If that fails, the linker model is asked once, and every edit must pass a token-level rename-only check.

The review showed the first version of that check was too loose: it ignored whitespace, so re-indenting could change Python control flow; it allowed swapping two names; and a file at the bundle root named `json.py` could shadow the standard library. Now everything outside names and import statements must stay byte for byte, renames can't swap or merge names, standard-library names are refused at the gate, and a piece's own helper module resolves relative to the piece.

## S8b: starting from a repo, and links in the goal

`/api/run` takes `base`: a public GitHub repo (with an optional ref) or a room's previous v8 result. Base files belong to nobody until a contract names them, and only that piece may change them. The links in the goal are read once at Root's first turn and summarised into source cards. A piece sees only the chunks its split cited.

The review found base text reaching the card writer and splitters with no untrusted label. Case twins (`readme.md` next to `README.md`) slipped past ownership, and the export wasn't the base plus the changes. Base text is now quoted and labelled like fetched text, and Clef must agree the goal asks to change an existing file before a contract may own it. Case twins are refused, and the export carries the untouched parts of the repo byte for byte, so a GitHub export can commit just the changes onto the original commit. `SELF_HOSTS` and clearer `FETCH_ALLOW` errors also came from this review.

## S9: follow-up prompts, the queue and adjustments

A finished room used to take no more work: a follow-up meant a new room, from scratch. A v8 room now keeps a queue of follow-ups in a **Prompts** panel beside the goal. When the room completes, the Durable Object's alarm applies the next one, so the queue runs with the page closed. **Adjust now** applies a prompt at once, also to a running room. Queued prompts can be edited, dragged into another order, skipped or removed, and each shows its state: queued, running, done, failed or skipped.

A follow-up is not a fresh start. The card writer gets the current card and the follow-up and returns the card with the change. The runtime keeps what the change leaves alone, never removes anything, and never changes a check that has passed. The new and changed requirements are routed the way a failed check is: to the pieces they serve, through Clef's ranks when no contract names them, and a piece that changes nothing passes them on. If no piece at Root takes one, Root splits off one new piece. Pieces the change doesn't reach keep their files, and the room completes only when the checks pass for the new revision. The Card panel lists each revision with the follow-up that caused it.

By default the queue stops when a prompt fails, and **Go on** resumes it; the room can be set to go on with the next prompt instead. Split v8 rooms now also pre-warm the Container just before the card's checks, and the Pipeline select describes v8 as it is now.

The review found that a Start or Clear during a change let the old project's card and goal land in the new run, so both are now refused until the change is applied, and a change checks that its run is still the same one after every model call. A requirement that served two pieces reached only the first; it now goes to each of them. A change to a deliverable alone reached nobody; it now reaches the piece that carries it. A change made while Root was still splitting made the split fail its own contracts, so it now waits for the split. An adjustment could restart a paused room with a fresh budget; now it never adds turns you didn't give. A queue on **continue** had no ceiling, so repair rounds now count across changes (at most 80 until the next Start), queued prompts share a turn allowance of 4x the Start budget, and two failures in a row stop the queue. Long goals hid the latest changes from Clef and the workers, who see only the start of the goal; every reader now gets the head of the goal and the latest changes. Smaller fixes: a requirement id is never reused, a restart mid-change leaves the queue with a **Go on** button, a prompt queued on a failed room says why it waits, and queue edits are checked against the goal limit and a version.

## Capability boxes S0 and S1: every compile in its own box

Code that agents or the card wrote used to run in one Container per run, with the internet on, and benchmark rooms shared four pooled Containers, so a process left behind by one compile could reach the next. Now each v8 compile opens a fresh, single-use `Box`: a new Durable Object with its own VM, from a second Container application under the `durable_object` scheduling policy (images `check`, `browser` and `fetch`). The box starts with `enableInternet: false`, runs today's build runner on the same request, and is destroyed afterwards. An alarm destroys it if its caller is gone. Benchmark rooms get their own box per compile and no longer take a pooled executor. The runner's own isolation still runs inside the box. A box that can't be opened, or doesn't confirm a fresh start with the internet off, holds the room at `checks_blocked` with its retries, and there is no fallback to the shared Container. Start and exec options come from two pure helpers that take no `env`, and the `Box` class never reads `env`. v7 keeps `BuildExecutor`.

`POST /api/dev/box-probe` (off unless `BOX_PROBE=1`, behind `APP_TOKEN`) measures, on a live deployment, what the next slices depend on. [docs/trying-v8.md](docs/trying-v8.md#6-capability-boxes-every-v8-compile-in-its-own-box) says how to run it and what to send back.

## Not done yet

- **S7**: making v8 the default and deleting the v7 paths. It waits for live runs.
