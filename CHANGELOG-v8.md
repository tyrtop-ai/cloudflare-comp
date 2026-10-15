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

## Card repair: lenient reading, runnable checks, and Clef as a reviewer

The first live runs (Qwen3-30B-A3B writing the card, Clef-flash vetting it) failed at the card for slips a person fixes at a glance. A Python CLI stopped at `card_failed` because its command was named `convert_temp`. An issue tracker stopped because `server.js` was listed as a function, and every requirement serving it went with it. A static to-do page completed with no real checks: Clef answered 0.49, 0.22 and 0.26 for its three requirements, and the p < 0.5 rule dropped all of them.

The card writer's answer now goes through three layers. The first reads it leniently: a file named as a function becomes a page, document, data file, command or file by its extension, `module.py:fn` is split, a missing path or source is filled in, and references match by name, path, case or stem. Each repair is listed in one `card_repaired` event. The second keeps only the rules that make a card safe and runnable; naming conventions and reference mismatches are no longer refusals. The third is Clef as a reviewer: it ranks deliverables for a reference that still matches nothing, and reviews the card once (is each goal sentence covered, does each check exercise its behaviour, does each deliverable's kind fit). Its NO answers are notes the writer revises its card for, in one call; notes that remain stay on the card.

Clef reviews; it never deletes. Vetting marks each requirement with its p and flags the ones below 0.5 as doubtful, in the Card panel and the feed. When the checks keep failing on a doubtful requirement, the hold names it first and the person decides. A base file the goal does not name and Clef doubts stays on the plan and waits at `base_confirm` for the person. In a v8 split, a piece, contract or owner Clef doubts is admitted and shown; an amendment that rewrites a deliverable Clef doubts it is about is applied, marked doubtful in the revision. The writer's raw answers are kept for diagnosis: in the export, and in the hold panel while a room is held at `card_failed`.

The review of this work found that a split-level `base_confirm` didn't wait, so the room completed without the file; that a review note could replace a valid card with a worse revision; and that a function named with its signature lost its requirement. Now only the person grants a base file (Clef's yes is a review, shown beside it), pieces carrying a waiting file wait with it, and Continue grants exactly what the hold lists. A revision runs only for substantive notes, keeps what the draft had, and is discarded when it validates worse. Signatures, `python` for `python3`, browser steps written as actions, http `status_code`, a page's script and `POST /x` with no kind all read as meant. Clef's ranking only adds to `serves`, in one batched call, and a manager's retask Clef doubts is applied and marked. The corpus now holds 46 cards, run with an ideal and a noisy Clef.

## Capability boxes S0 and S1: every compile in its own box

Code that agents or the card wrote used to run in one Container per run, with the internet on, and benchmark rooms shared four pooled Containers, so a process left behind by one compile could reach the next. Now each v8 compile opens a fresh, single-use `Box`: a new Durable Object with its own VM, from a second Container application under the `durable_object` scheduling policy (images `check`, `browser` and `fetch`). The box starts with `enableInternet: false`, runs today's build runner on the same request, and is destroyed afterwards. An alarm destroys it if its caller is gone. Benchmark rooms get their own box per compile and no longer take a pooled executor. The runner's own isolation still runs inside the box. A box that can't be opened, or doesn't confirm a fresh start with the internet off, holds the room at `checks_blocked` with its retries, and there is no fallback to the shared Container. Start and exec options come from two pure helpers that take no `env`, and the `Box` class never reads `env`. v7 keeps `BuildExecutor`.

`POST /api/dev/box-probe` (off unless `BOX_PROBE=1`, behind `APP_TOKEN`) measures, on a live deployment, what the next slices depend on. [docs/trying-v8.md](docs/trying-v8.md#6-capability-boxes-every-v8-compile-in-its-own-box) says how to run it and what to send back.

## Second live runs: checks a worker can implement

The second live runs got all three rooms to their checks, with working apps in fresh, internet-off boxes (about 1.2 s warm, 10 to 15 s on an image's first use). Then each failed on how its checks were written, matched or reported. The to-do page's `fill {label: "Task"}` timed out on a field that had only a placeholder; the tracker's `fill {label: "Title"}` did the same on `<input id="title" placeholder="Title">`; both checks began with `fill` on a blank page, and the repair said only "step 1 (fill) failed". The CLI's R4 wanted exit 1 and "Invalid unit" on stderr, and nothing its worker saw said so. A file check wanted `<link … href="styles.css">` and the page had `<link … href="styles.css" />`. The to-do card's R1 opened `http://localhost:8000/index.html`, layer 2 refused it, and it was dropped. The tracker's files began with a leaked `===` line.

The rule now: a check's expected values and inputs stay hidden; the interface it exercises is part of the contract, like a function's name.

- **Interface facts.** Each served deliverable's contract states what its requirements' checks use: the fields they fill and the buttons and links they click, by label; the pages and routes; a command's argv shape with each value as its kind; the exit status it expects and the stream each message goes to. Workers also read the statements of the requirements their contracts serve from the first turn. A failure report names the field, button, route or command line, and when a page has no such field it lists what the page offers. Values, inputs, stdin, fixtures and expected texts are still masked.
- **Tolerant locators.** A fill tries the label, the placeholder, the aria-label, the name or id by its words, then the only text field; a click matches its name in any case, then as a link, button or text; a check opens `/` first.
- **Implementable.** Clef's card review asks of each requirement whether its statement and contract are enough to pass the check, values aside. A NO goes back to the writer, who states in `says` what the check needs.
- **No requirement lost.** A URL on the run's own host is read as its path. A check layer 2 still refuses keeps its requirement, marked untested with the refusal as a review note, shown in the Card panel and never run.
- **Tolerant `has`** for markup (whitespace, quote style, a self-closing `/`), and a **parser** that reads a file header split across lines or missing its closing `===`.
- A box over 5 s to ready is recorded **cold**.

The review of this work found that a statement, an interface fact or a failure report could still carry a check's value: a statement such as "Converting 100 from Celsius prints 212" reached workers from the first turn, an input repeated in two checks was shown as a subcommand, JSON keys and button names that were another check's expected text were shown, and a query string reached a report. The rule is now structural. One set per card holds every expected value and every input of every check (argv values, stdin, input files, typed texts, request bodies, query values, path segments no contract or goal states, call arguments, expected texts). Every text a worker reads that comes from the card goes through it: statements, interface facts, failure reports. An argv or path word is shown only when a contract or the goal states it and no check uses it as a value. JSON keys are never shown, and a button named by a check's value is shown without its name. The card writer is asked for statements of behaviour and interface. Clef's implementable question reads the check with its values as their kinds. A check that looks for wording the goal does not state draws a note asking for presence, stream and status instead, and `"stderr": true` asks for a message on stderr whatever its wording.

A requirement whose check is still refused after the writer's one revision (now asked for explicitly) stays untested. If it is about a page, command, function or route, the room no longer completes: it holds at `checks_untested`, Continue accepts the project as it is (logged as `untested_accepted`), and a follow-up prompt can change the card instead. The parser drops only a line of exactly `===` right after a header, and reads a header without its closing `===` only between files. Locators match exactly first, then a unique whole-word part; a click looks only at elements of its role; there is no only-field fallback, and several partial matches fail with the candidates named. Tolerant `has` applies only to markup files, and never inside attribute values or text.

## Third live runs: wording is interface, progress is passing

The third live runs passed every behaviour check: adding and removing a to-do in Chromium, `100 C` → `212.0`, and `POST /tickets` → 201. Every remaining failure was a check that wanted wording or internals no worker could know. The to-do's style sheet had to contain `todo-item {`, a class name. The CLI's R3 wanted `invalid literal` on stderr, which is Python's own error text, and the room repaired it for ten rounds because a changed message counted as progress. The tracker's page had to show "Ticket List", and its `index.html` began with a stray `=== CONTENT ===` line. Workers needed a second model call for 41 of 46 first answers.

- **Values and wording.** A value is computed from a check's inputs, like 212 for 100 C, and it stays hidden. Wording is fixed text a check expects whatever the input, like "Ticket List", "invalid literal" or a class name. Wording is part of the spec, so it is now shown. An expected text counts as a value if it has a digit, equals or contains an input of the card's checks (or an input contains it), or is JSON. Any other expected text is wording. Wording is an interface fact on the deliverable it serves:
  - `page / shows the text "Ticket List"`;
  - `… expects exit status 1 and a message on stderr containing "invalid literal"`;
  - `style.css contains "body {", "todo-item {"`.

  A failure report names the wording it looked for. A hidden benchmark requirement keeps all its text hidden.
- **Internals.** Clef's review asks of a file check on a code, style or script file whether it tests what a user meets or an internal detail. A NO goes back to the writer. A check that survives the revision stays, and its wording is shown.
- **Vetting** asks "Would someone who wrote this goal expect this to be true of the result?" It reads the goal, each `says` and its check, with values shown as their kinds. A NO from the internals question also marks a requirement doubtful, with the reason "internal detail". The hold names that reason. For one release, the old question's p is kept as `vet_p_literal`, on the requirement and in the span, from the same Clef call.
- **Progress** now means a requirement passes, or a failing one fails in a different category: did not start, timed out, wrong exit, wrong output, missing text or crashed. A change in the failure's wording is not progress. The live CLI sequence now stops after three rounds without progress.
- **Parser.** One section label such as `=== CONTENT ===` right after a FILE header is dropped. A label anywhere else stays.
- **Format.** The format is now one short answer of the exact shape, with the control object on one line. Before, the field list sat under the CONTROL line as `- "summary": …` lines, which a small model copied. The control block is also read when a model writes it as one field per line, with a trailing comma, or with `True`. A file left open when the model stopped by itself is kept as written; only a file cut off by the token limit is written again. On a scripted set of 13 realistic answers, second calls went from 4 to 0, files written again from 2 to 0, and answers with any fallback from 8 to 4. The JSON action still works.

The review of this work found four problems, now fixed:

- **Wording is decided per check.** The value rule let any transform of an input through: `olleh` for `hello`, `XIV` for `14`, `Monday` for a date, a sorted list, or a page's text after a click. A text is now shown only when the value rule calls it wording and one of these holds:
  - its check takes no input. For a page, the text must be expected before any fill, click or press. A flag the goal or a contract states, like `--help`, counts as interface, not input.
  - it is the stderr text of a command expected to fail.

  A text the goal or a served contract states, like "FizzBuzz", is no secret, but it is never shown bound to a check that takes input. Wording that a hidden requirement or an input holds in part is a value. Quoted wording is masked in repairs the same way as in the facts. The six wording texts of the live cards stay visible.
- **Progress reads how far a check got.** A failure's key is now its id, its category and the point it reached: the failing step of a browser, http or call check, or the number of expectations a file or command check met. A round is progress when:
  - a requirement passes for the first time since it first failed;
  - a requirement fails in a category it never failed with before;
  - a requirement gets further than it ever has;
  - at its furthest point, its stdout comes nearer to what the check expects. This tie-breaker is never shown to agents.

  Each requirement's best is kept across the whole run, so flip-flopping cannot count as progress. Route exhaustion uses the same key, so a worker that got further is not taken off the requirement.
- **Field-line control.** A CONTROL line followed by field lines closes an open file only if both hold:
  - the file is not a data, config or document file;
  - the field lines include `summary` or `done`.

  A control block that starts with a field line is read as one object, so an `ask` or `pieces` value that holds objects is read correctly.
- **A file left open at a natural stop** is kept only if all of these hold:
  - the answer had a control block;
  - the Worker can parse the file (JavaScript, JSON);
  - the file does not end in a control line or prose.

  Any other such file is written again, as before. An answer that left a file open is never marked done by default. On the scripted set, now 14 answers: second calls went from 4 to 0, files written again from 3 to 1, and answers with any fallback from 9 to 5.

## Fourth live runs: elements, not markup; packages on every row

The CLI room completed in about 30 s. The to-do card's R1 looked for `<input type='text'` and `<button>Add</button>` as the page's visible text, which no page shows; the page had both, and the room ran out of repairs. The tracker card decided "Used Python Flask" in a project with no third-party packages: every run failed on `No module named 'flask'`, the linker spent about 27 s asking its model about `flask` (4 `link_unresolved`), Root's four asks for Flask were dropped ("the top has no manager"), and the room paused after three rounds without progress.

- **Element steps.** A browser check may now say `{"expect_element": {"selector", "text"}}` (and `expect_no_element`). The selector is simple: a tag, then `#id`, `.class`, `[attribute]` or `[attribute=value]`. The adapter passes when the page has at least one match, with the text in any case if given; a miss names the elements of that tag the page has. Layer 1 reads an `expect_text` or `expect_no_text` written as markup as the elements it names (`<input type='text'` is `input[type=text]`, `<button>Add</button>` is `button` with the text "Add") and records a card note, which the review notes repeat so the writer learns the form. A worker reads it as interface: `page /index.html has a text input, a button "Add"`.
- **Packages on every row.** Each agent's row lists its `packages` (`{name, language, provides}`) beside its contracts. Root's row is created with the installed set: each installed toolchain row's curated standard library (http.server, json, sqlite3, …; node:http, node:fs, node:path, …), by the box's inventory. A split gives each piece a part of its parent's packages, as it gives contracts: the splitter reads `your_packages` and may name `packages` per piece; a name its parent's row lists is the piece's, any other becomes the piece's ask, and a piece given none gets its parent's packages of its language. A writer's catalogue (`available`) lists its own packages. No agent receives a global list.
- **Asking for a package** works like asking for a contract. The ask goes up the asker's line: the first row that holds the name, or a package whose `provides` meets the need, answers; a row above grants it (added to every row between) and logs `package_granted`; a hop logs `package_relayed`. The top, holding nothing for the need, answers with what it holds, and the request waits for the person in `package_requests`. Every answer names what exists: "For HTTP server, your manager granted http.server (HTTP server), now in your packages: use it." The four live asks were dropped because the top's asks went nowhere unless the broker answered them; a package ask is now the broker's, at the top too.
- **missing_module.** A run that needed a package outside the project (`No module named 'flask'`, `Cannot find package 'express'`) is its own failure category. The failure goes up its writer's line as that package's ask, and the answer rides with the failure: "The run needed flask, which the project's installed packages leave out. For HTTP server, your packages hold http.server (HTTP server): use it as it is."
- **The linker** leaves a package alone: a module some row lists, holds in its standard library or knows as a third party's (stands_for, third_party), with no project file of that name, is never sent to the link model and logs no `link_unresolved`. Any other unknown name may be a part under another name, and the linker reads it as before.
- **The card** writer reads Root's packages (`installed_packages`), and Clef's review asks whether the deliverables, run commands and decisions use only what is installed (`CLEF.installed`). A NO is a substantive note: "use what is installed: http.server, urllib.request, …".
- Clef's cost (about 0.4 to 0.9 s per batch) is unchanged.
- **The prompt handler.** A short-lived step above Root (`handPrompt`), not a model call: it takes the person's prompt, creates Root's row as every parent creates a child's (its packages the installed set), sets Root's `parent` to its own id (`prompt:1`), hands the prompt over and ends. A queued prompt or an amendment gets a handler of its own, which hands the change to the existing Root and ends; it never creates a second Root. Handlers live in `prompt_handlers` with `spawned_at` and `ended_at` (the snapshot and the export show them), never among the agents, and hold nothing afterwards. The room reads a handler parent as the top of the tree (`isTop`, and `handed_by` on Root's row), so every place that meant "this is Root" behaves as before.

## Not done yet

- **S7**: making v8 the default and deleting the v7 paths. It waits for live runs.
