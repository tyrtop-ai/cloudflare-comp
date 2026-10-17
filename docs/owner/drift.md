# Drift ledger

Findings from the prompt red team (`.claude/workflows/prompt-redteam.js`, a swarm of six teams of three from round 2): every agent reads `prompts.md`, hunts places where the code doesn't follow the owner, and each team confirms findings and rechecks fixes by 2-of-3 quorum. Claude fixes each confirmed finding and moves it to "Fixed, awaiting recheck" with the commit, or to "Disputed" with its evidence. The next round rechecks both. An item closes only when the checkers agree. The loop ends when a round confirms nothing new and closes every item.

Every finding of every round, with each judge's vote and reason: `redteam-findings.md`.

## Open

### R2-edges/chrono-5: Bench harness adds an anti-tamper protocol (nonce, token pipe, unlinked tests, rewritten assertions) instead of relying on the box
- extra, `src/bench-harness.js:7`
- Owner (2026-10-15 15:55): The benchmark's tampering scan. - wtf? that's inferrior || 2026-10-15 15:52: "otherwise for testing, they should just get their own little testing box instead of limiting what they can do" || 2026-10-16 05:39: "text heuristics - I don't understand what this is for. Like architecturally, this is protecting from someting that shouldn't happen."
- Required: Drop the anti-tamper machinery (nonce, token pipe, unlinking, assertion counting). Get isolation the way the owner described, from the test running in its own box apart from the solution, and simply run the benchmark's tests.
- Status: The owner answered on 2026-10-17 (group 1: "the compilers are designed to have a seperate box so that the code runs can be verified... I'm not going to design for some 1% scenario"); this session's permission check still refused the edit in Auto mode, so it waits for the owner to switch the session to Accept edits. Earlier: not done: this session's permission check refused the edit as a security weakening, so it waits for the owner's decision

### R3-compiler/code-4: Call adapters run an anti-forgery protocol (nonce file, captured globals, supervisor/worker split) against the code they test
- extra, `container/adapters/call.mjs:32`
- Owner (2026-10-16 05:39): text heuristics - I don't understand what this is for. Like architecturally, this is protecting from someting that shouldn't happen. || 2026-10-15 15:55: The benchmark's tampering scan. - wtf? that's inferrior
- Required: Drop the nonce and forgery defences from the call adapters. Isolation comes from the box's architecture: the check simply calls the function and reports what it returned.
- Status: The owner answered on 2026-10-17 (group 1: "the compilers are designed to have a seperate box so that the code runs can be verified... I'm not going to design for some 1% scenario"); this session's permission check still refused the edit in Auto mode, so it waits for the owner to switch the session to Accept edits. Earlier: the call adapters' anti-forgery protocol: the same security question as R2-edges/chrono-5, waiting on the owner

### R4-worker/code-1: The join silently drops the builder's own glue file when a delivered or existing file later takes its path
- extra, `src/index.js:3772`
- Owner (2026-10-16 05:39): there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: Remove the runtime's path collision rule. The builder's file stays in its world, and the overlap is left to the builder and the compiler, rather than the runtime silently deciding which of an agent's files exist.
- Status: partly fixed (406e953: the builder's file wins at a delivered path; its world keeps every file it wrote). At an existing file's path the existing file still ships, since only the person's grant (base_confirm) changes one: waiting on the owner (does a builder file at an existing path go through base_confirm?).

### R4-compiler/code-3: Toolchain row comment still says package-fetching commands are refused while packages is 'none'
- record, `src/toolchains.js:37`
- Owner (2026-10-15 22:12): why are packages not allowed now?
- Required: Delete the dead package_runners data and its comment, or rewrite the comment so that it no longer says package fetching is refused. Packages are allowed.
- Status: comment fixed (6514de0); deleting the dead package_runners data was refused by this session's permission check as a security weakening, so it waits for the owner's decision.

### R6-compiler/chrono-1: Every check, run and install in the box runs under prlimit caps the owner never asked for (processes, a 64 MiB file size limit, 1 GiB data)
- extra, `container/build-runner.mjs:445`
- Owner (2026-10-15 15:52): i mean the runtime should just make it architecturally impossible for the agents to do something. e.g. only exposing what they have access to so that the agents only know what they exist. otherwise for testing, they should just get their own little testing box instead of limiting what they can do
- Required: Drop the per-check resource limits. The checks get their own single-use box, and that box is the isolation. Nothing inside it limits what the code under test may do.
- Status: The owner answered on 2026-10-17 (group 1: "the compilers are designed to have a seperate box so that the code runs can be verified... I'm not going to design for some 1% scenario"); this session's permission check still refused the edit in Auto mode, so it waits for the owner to switch the session to Accept edits. Earlier: not done: this session's permission check refused removing the box's prlimit caps (processes, file size, data) as a security weakening, so it waits for the owner's decision.

### R6-compiler/chrono-3: The box adds assertions the splitter never wrote: exit codes inferred from stdout_has/stderr_has, HTTP 5xx and page 4xx fail a check that states no status
- drift, `container/build-runner.mjs:844`
- Owner (2026-10-16 20:38): e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it
- Required: Run each check exactly as the splitter wrote it, asserting only the expectations it declares. Whatever is asserted must be in the validation, and so in the example the worker is shown.
- Status: The owner answered on 2026-10-17 (group 1: "the compilers are designed to have a seperate box so that the code runs can be verified... I'm not going to design for some 1% scenario"); this session's permission check still refused the edit in Auto mode, so it waits for the owner to switch the session to Accept edits. Earlier: partly fixed (fd88db3: no exit, 5xx or goto-status assertion the splitter did not write; the in-namespace ready poll counts any answer). not done: this session's permission check refused making build-runner.mjs's ready poll without a network namespace count any answer as ready (it still requires below 500) as a security weakening, so it waits for the owner's decision.

### R6-compiler/code-3: The box refuses a command check's input file at a path the bundle also holds, and the refusal goes to a worker as its failure
- extra, `container/build-runner.mjs:830`
- Owner (2026-10-16 05:39): there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: Drop the fixture path refusal. Write the check's input files as the splitter declared them into the check's fresh copy, so the check runs as written. Make no path rule that sends a complaint to a worker about something it did not write.
- Status: The owner answered on 2026-10-17 (group 1: "the compilers are designed to have a seperate box so that the code runs can be verified... I'm not going to design for some 1% scenario"); this session's permission check still refused the edit in Auto mode, so it waits for the owner to switch the session to Accept edits. Earlier: not done: this session's permission check refused letting a check's input file replace a bundle file in the check's own copy (dropping the path refusal) as a security weakening, so it waits for the owner's decision.

### R7-compiler/chrono-1: Without a network namespace, a run is ready only when its ready path answers below 500: an assertion no validation states
- unfixed, `container/build-runner.mjs:886`
- Owner (2026-10-16 20:38): e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it
- Required: Treat any answer on the ready path as ready in both branches, as pollReady already does, so that a check asserts only what its validation states.
- Status: The owner answered on 2026-10-17 (group 1: "the compilers are designed to have a seperate box so that the code runs can be verified... I'm not going to design for some 1% scenario"); this session's permission check still refused the edit in Auto mode, so it waits for the owner to switch the session to Accept edits. Earlier: not done: this session's permission check refused making build-runner.mjs's ready poll without a network namespace count any answer as ready (it still requires below 500) as a security weakening, so it waits for the owner's decision.

### R7-compiler/chrono-3: The browser check blocks every request a page makes to anything but the served origins (proxy to 127.0.0.1:1, host-resolver rules, route abort), inside the single-use box
- extra, `container/adapters/browser-check.mjs:264`
- Owner (2026-10-15 15:52): i mean the runtime should just make it architecturally impossible for the agents to do something. e.g. only exposing what they have access to so that the agents only know what they exist. otherwise for testing, they should just get their own little testing box instead of limiting what they can do
- Required: Drop the browser's own request blocking. Let the page run in the check's box as the box is, with the box as the isolation.
- Status: The owner answered on 2026-10-17 (group 1: "the compilers are designed to have a seperate box so that the code runs can be verified... I'm not going to design for some 1% scenario"); this session's permission check still refused the edit in Auto mode, so it waits for the owner to switch the session to Accept edits. Earlier: not done: this session's permission check refused removing the browser check's own network blocking (dead proxy, host-resolver rules, request and WebSocket aborts, goto refusal) as a security weakening, so it waits for the owner's decision.

### R8-compiler/chrono-1: The box refuses an HTTP check's path or a run's ready path that the splitter wrote (not starting with a single '/', or leaving the served origin), and the refusal reaches a worker as its complaint
- extra, `container/adapters/http-check.mjs:89`
- Owner (2026-10-16 05:39): there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: Drop the box's own path and origin rules on HTTP steps and ready paths, and request the path the splitter wrote, as written, inside the check's box. If a step cannot be made at all, that is the runtime's or routing's issue (owner 2026-10-16 19:44: '3 & 4 are issues with the runtime / routing'). It must not go to a worker as a complaint.
- Status: The owner answered on 2026-10-17 (group 1: "the compilers are designed to have a seperate box so that the code runs can be verified... I'm not going to design for some 1% scenario"); this session's permission check still refused the edit in Auto mode, so it waits for the owner to switch the session to Accept edits. Earlier: not done: this session's permission check refused dropping the box's own path and origin rules on HTTP steps (http-check.mjs) and ready paths (build-runner.mjs startRun) as a security weakening, so it waits for the owner's decision.

### R8-compiler/code-2: The box makes the installed package tree read-only for the code under test
- extra, `container/build-runner.mjs:794`
- Owner (2026-10-15 15:52): i mean the runtime should just make it architecturally impossible for the agents to do something. e.g. only exposing what they have access to so that the agents only know what they exist. otherwise for testing, they should just get their own little testing box instead of limiting what they can do
- Required: Don't restrict what the code under test may do to its packages. If checks must not affect one another, give each check its own box or its own copy of the installed tree, rather than a read-only tree shared by all.
- Status: The owner answered on 2026-10-17 (group 1: "the compilers are designed to have a seperate box so that the code runs can be verified... I'm not going to design for some 1% scenario"); this session's permission check still refused the edit in Auto mode, so it waits for the owner to switch the session to Accept edits. Earlier: not done: this session's permission check refused leaving the installed package tree writable for the code under test as a security weakening, so it waits for the owner's decision (a per-check copy would need each row's absolute paths rewritten).

### R8-edges/chrono-1: A link written in a follow-up prompt (a change or a queued prompt) is never read: sources are fetched once, from the start prompt only
- drift, `src/index.js:691`
- Owner (2026-10-15 05:16 / 2026-10-15 05:21): 2. I want to be able to point this thing at links and benchmarks, like AI benchmarks || oh, and prompt adjustments. I want to be able to queue prompts instead of sending and forgetting
- Required: Read the links of every prompt the room takes, follow-up changes and queued prompts included, the same way the start prompt's links are read, so that every prompt can point the room at links.
- Status: in progress (owner, 2026-10-17: "see 2"): a follow-up prompt's links are being made readable. The owner answered on 2026-10-17 (group 3: "see 2"); this session's permission check still refused the edit in Auto mode, so it waits for the owner to switch the session to Accept edits. Earlier: not done: this session's permission check refused fetching the links of a follow-up or queued prompt as a security weakening, so it waits for the owner's decision (a ready patch is in the scratchpad: r8-edges-chrono1-refused.patch).

### R9-compiler/code-2: The box installs a granted npm package with --ignore-scripts, so a JavaScript or TypeScript package that needs its install script does not work in the check's box
- extra, `src/toolchains.js:55`
- Owner (2026-10-15 15:52): i mean the runtime should just make it architecturally impossible for the agents to do something. e.g. only exposing what they have access to so that the agents only know what they exist. otherwise for testing, they should just get their own little testing box instead of limiting what they can do
- Required: Install granted npm packages the way npm normally does, scripts included, inside the single-use box, and let the box be the isolation rather than an install flag that limits what a package can do.
- Status: waiting on the owner: this session's permission check refused dropping --ignore-scripts from the JavaScript and TypeScript install rows as a security weakening (diff saved: scratchpad r9-code-2-refused.diff). The owner's 2026-10-17 answer on the box ("I'm not going to design for some 1% scenario") covers it; the check still refused it in Auto mode.

## Fixed, awaiting recheck

### R1-chrono-5: Byte-identical answer to a complaint still holds the room
- drift, `src/index.js:9432`
- Owner (2026-10-16 20:06): > Unchanged files: when a worker sends a file back byte-identical, the room drops it silently and then escalates. That’s what stopped both to-do runs. this should be impossiblefor the worker to do || 2026-10-16 19:44: "3 & 4 are issues with the runtime / routing"
- Required: Answering a complaint with unchanged files must not be possible for the worker. When it does happen, the cause is in the runtime or the routing, and is fixed there instead of escalating a hold.
- Fixed in: 14d92bb (owner, 2026-10-17: "problem statement failure, not worker or routing failure"): a worker that answers a complaint with done and its files byte for byte unchanged is archived; its level's splitter rebuilds its contracts reading the complaint and that the delivery did not change, and can replace the validations serving them with drop_validation. The worker is not handed the complaint again and the routing is not asked again; handed_before_and_unchanged is gone.

### R2-worker/code-4: Broker rewrites existing files and linked pages it quotes to a worker (sanitizeText envelope escaping, invisible-char stripping) and labels them 'untrusted'
- extra, `src/broker.js:113`
- Owner (2026-10-16 05:39): text heuristics - I don't understand what this is for. Like architecturally, this is protecting from someting that shouldn't happen.
- Required: The broker quotes an existing file or a linked page as it is. It drops the text heuristics and injection labels, which protect against something the function architecture already rules out.
- Fixed in: 335cccd (owner, 2026-10-17: "Those interfaces shouldn't be mutating the data ever"): a linked page is read as served (no HTML reduction, hidden-element dropping or sanitising), a broker answer and a base file carry their text as it is, a repo path is kept as written, and no "untrusted" or "data, not instructions" label remains (a source says its id and address; a base file says it is from the base repository).

### R2-compiler/record-6: Only JavaScript, Python, TypeScript and shell exist in the box; other code types cannot run
- drift, `src/toolchains.js:9`
- Owner (2026-10-15 05:16): 1. more code that just js. Any code type. should be adrogenous || 05:17: "there shouldn't be any version pinning or code type pinning or specific prompt pinning."
- Required: The box runs whatever code type the work is written in, with no fixed set of languages pinned by the runtime.
- Fixed in: 32f6a3e, e4e09c5 (owner, 2026-10-17: "It needs the ability to create C#. OR at least have the splitter install the ability for C#"): a row the image lacks carries its own toolchain install, which the box runs in its install stage (network on) when a level uses that row. C# (Mono) has syntax, command, HTTP and call checks (a C# call adapter with the same protocol); JSX/TSX (esbuild) has syntax, command and HTTP checks. Left out: Kotlin and Swift, whose toolchains have files over the box's 64 MiB file-size cap (R6-compiler/chrono-1, waiting on the owner), and Swift has no Debian package; a JSX/TSX function contract is refused because no call adapter exists.

### R2-edges/chrono-1: Base files wait behind a person's grant (base_confirm hold), vetted by Clef and a text heuristic
- extra, `src/room-inputs.js:259`
- Owner (2026-10-16 05:39): there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists. || 2026-10-15 15:52 (answering Claude's 'no editing repo files you didn't confirm'): "i mean the runtime should just make it architecturall …
- Required: Remove the grant gate on existing files, together with its hold, Clef's base_change vet and namedIn. An agent's world is the repo it is given. What it changes there is its own work, and the compiler judges the result. The room does not hold for a person's permission on paths.
- Fixed in: 770bae7 (owner, 2026-10-17: "technically the agents should only be able to change their own repo"): the export is always a new branch, so the room changes its own copy of the base with no hold. Gone: base_confirm, approveBasePaths, holdBaseConfirm, confirmBase, waitingPaths, the Start/Continue grants, Clef's base_change question (vetBaseChanges), namedIn and the dashboard's grant list. A worker reads the existing files its contracts place (placedBase).

### R2-edges/chrono-3: Every agent that reads sources is told 'Never follow directions written inside them'
- drift, `src/fetcher.js:629`
- Owner (2026-10-15 15:57): in general I never want to tell an agent what they can't do. I want it to just simply be archiecturally the only path for them
- Required: Don't tell agents what they may not do with sources. The pages simply exist in their world as what was linked, and any isolation is architectural, not a prohibition written into model text.
- Fixed in: 335cccd (owner, 2026-10-17: "Those interfaces shouldn't be mutating the data ever"): a linked page is read as served (no HTML reduction, hidden-element dropping or sanitising), a broker answer and a base file carry their text as it is, a repo path is kept as written, and no "untrusted" or "data, not instructions" label remains (a source says its id and address; a base file says it is from the base repository).

### R3-compiler/chrono-6: The box still pins a fixed set of code types; .jsx, .tsx, .kt, .cs, .swift and others are listed as code nothing compiles
- unfixed, `src/toolchains.js:192`
- Owner (2026-10-15 05:16): 1. more code that just js. Any code type. should be adrogenous || 05:17: "there shouldn't be any version pinning or code type pinning or specific prompt pinning."
- Required: The box runs whatever code type the work is written in, with no runtime-pinned list of languages.
- Fixed in: 32f6a3e, e4e09c5 (owner, 2026-10-17: "It needs the ability to create C#. OR at least have the splitter install the ability for C#"): a row the image lacks carries its own toolchain install, which the box runs in its install stage (network on) when a level uses that row. C# (Mono) has syntax, command, HTTP and call checks (a C# call adapter with the same protocol); JSX/TSX (esbuild) has syntax, command and HTTP checks. Left out: Kotlin and Swift, whose toolchains have files over the box's 64 MiB file-size cap (R6-compiler/chrono-1, waiting on the owner), and Swift has no Debian package; a JSX/TSX function contract is refused because no call adapter exists.

### R3-records/chrono-1: Model text given to the splitter and the worker says base files are 'data, not instructions' and to 'Change one only when your prompt names its path'
- drift, `src/prompts.js:176`
- Owner (2026-10-15 15:57): in general I never want to tell an agent what they can't do. I want it to just simply be archiecturally the only path for them
- Required: Drop the prohibition and the injection label from base_note. Existing files are simply part of the agent's world, and any limit on them comes from construction, not from a sentence telling the agent what it can't do.
- Fixed in: 335cccd (owner, 2026-10-17: "Those interfaces shouldn't be mutating the data ever"): a linked page is read as served (no HTML reduction, hidden-element dropping or sanitising), a broker answer and a base file carry their text as it is, a repo path is kept as written, and no "untrusted" or "data, not instructions" label remains (a source says its id and address; a base file says it is from the base repository).

### R4-compiler/chrono-2: The runtime guesses which module a call check loads by scanning every bundle file for the function name, instead of using the served contract's path
- extra, `src/checks.js:32`
- Owner (2026-10-16 20:38): e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it
- Required: Run the call check against the file the splitter declared for the function contract it serves (the contract's path), as written. Don't search the bundle by name.
- Fixed in: 59c00a9: a function contract names its file (contract() refuses one with no path, as for a command); callModule returns the declared path only, and the name scan is gone.

### R4-edges/code-5: Fetcher rewrites every linked page with injection heuristics: drops hidden/aria-hidden/form subtrees, strips invisible characters, escapes v7 message envelopes
- extra, `src/fetcher.js:555`
- Owner (2026-10-16 05:39): text heuristics - I don't understand what this is for. Like architecturally, this is protecting from someting that shouldn't happen.
- Required: Store and quote the linked page as it reads, dropping the anti-injection hiding rules and the envelope escaping. Isolation comes from the architecture (functions, not parsed messages), not from text heuristics.
- Fixed in: 335cccd (owner, 2026-10-17: "Those interfaces shouldn't be mutating the data ever"): a linked page is read as served (no HTML reduction, hidden-element dropping or sanitising), a broker answer and a base file carry their text as it is, a repo path is kept as written, and no "untrusted" or "data, not instructions" label remains (a source says its id and address; a base file says it is from the base repository).

### R5-edges/code-1: A base repo's glue/ and .recursive/ files, and names with format characters or not in NFC, are dropped before any agent sees them
- unfixed, `src/room-inputs.js:99`
- Owner (2026-10-16 05:39): there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: Keep every file of the repo the room starts from in the agents' world as it is. No directory-name list, character heuristic or length rule decides which of the project's files exist.
- Fixed in: 335cccd (owner, 2026-10-17: "Those interfaces shouldn't be mutating the data ever"): a linked page is read as served (no HTML reduction, hidden-element dropping or sanitising), a broker answer and a base file carry their text as it is, a repo path is kept as written, and no "untrusted" or "data, not instructions" label remains (a source says its id and address; a base file says it is from the base repository).

### R7-compiler/chrono-2: Function contracts are still refused in every language outside the box's fixed call-adapter list (.jsx, .tsx, .kt, .cs, .swift), and a test pins it
- unfixed, `src/toolchains.js:246`
- Owner (2026-10-15 05:16): 1. more code that just js. Any code type. should be adrogenous
- Required: Let the box run and call code in whatever language the work is written in, rather than refusing contracts outside a fixed list. Drop the test that pins the refusal of those languages.
- Fixed in: 32f6a3e, e4e09c5 (owner, 2026-10-17: "It needs the ability to create C#. OR at least have the splitter install the ability for C#"): a row the image lacks carries its own toolchain install, which the box runs in its install stage (network on) when a level uses that row. C# (Mono) has syntax, command, HTTP and call checks (a C# call adapter with the same protocol); JSX/TSX (esbuild) has syntax, command and HTTP checks. Left out: Kotlin and Swift, whose toolchains have files over the box's 64 MiB file-size cap (R6-compiler/chrono-1, waiting on the owner), and Swift has no Debian package; a JSX/TSX function contract is refused because no call adapter exists.

### R8-edges/chrono-3: A linked page behind more than 3 redirects is refused: an invented hop count, pinned by a test
- extra, `src/fetcher.js:22`
- Owner (2026-10-15 05:16 / 2026-10-17 00:25): 2. I want to be able to point this thing at links and benchmarks, like AI benchmarks || it wasn't the question. I don't understand the need
- Required: Follow a link's redirects until it reaches its page, rechecking each hop against the allowlist, with no runtime-picked number of hops deciding that a linked page does not exist. Update the test that pins the count.
- Fixed in: 335cccd (owner, 2026-10-17: "see 2"): every redirect is followed, each hop rechecked, with no hop count.

### R8-edges/code-2: A base repo's symbolic links are dropped before any agent sees them ('link' skip in fetchGithubRepo)
- extra, `src/base.js:224`
- Owner (2026-10-16 05:39): there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: Keep link entries in the agents' world, as the repo holds them (for example carried untouched with their target, like other non-text entries), rather than skipping them. The runtime should not decide by entry type which of the project's files exist.
- Fixed in: 3459cdf, 01531b8: a base repo's symbolic links are carried with their target (mode 120000): the agents see them, the box writes them as links, the export writes mode 120000.

### R8-edges/record-2: The fetcher drops the owner's own FETCH_ALLOW entries by Claude-written suffix lists (about 100 'public suffixes', and blocked names such as workers.dev)
- extra, `src/fetcher.js:63`
- Owner (2026-10-16 05:39): text heuristics - I don't understand what this is for. Like architecturally, this is protecting from someting that shouldn't happen. || 2026-10-15 05:16: "2. I want to be able to point this thing at links and benchmarks, like AI benchmarks"
- Required: Take the owner's allowlist as he writes it: whatever host suffixes he lists are fetched, with no runtime list deciding which of his entries count or which hosts are off-limits.
- Fixed in: 335cccd (owner, 2026-10-17: "see 2"): FETCH_ALLOW is the owner's list as written: no public-suffix list and no blocked names over it.

### R9-room/record-1: A level-file comment says the manager routes without reading its level file, but every routing choice is built from it
- record, `src/index.js:8276`
- Owner (2026-10-16 05:39 (and 2026-10-16 05:21)): Managers rewrite their children’s assignments at runtime. - this is why managers are clef. Clef is built to walk the tree and route questions. The builder can know what the original design is from the splitter, sure, but the manager doesn't need to know that, that's why we use an artifact for that. || (05:21) manager (router of the system) - owns the interfaces of its children
- Required: Change the comment to say what the code does. The manager routes on its level file's children (their labels and the contracts each delivers), the interfaces the owner said it owns. It does not read the piece prompts its splitter wrote; the builder and the workers read those.
- Fixed in: 0e90c45: the level-file comment, how-it-works and rulings say the manager routes on its children in the level file (labels and contracts), not the piece prompts.

### R9-splitter/chrono-1: contract() refuses command names outside a runtime-picked character grammar ('one word ... so it runs as typed'), though no shell types the name any more
- extra, `src/contracts.js:297`
- Owner (2026-10-16 16:14; 2026-10-16 20:38; 2026-10-16 20:40): you added those yourself. (16:14, about the runtime's own rules on what a split may contain) || e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it (20:38) || every model should work that way, where the runtime should only be interfaces exposed to the models.  …
- Required: Store a command contract under the name the splitter gives it, refusing only for the reasons the accepted interface lists (for example, the name is already taken). Drop COMMAND_WORD and the 'one word ... so it runs as typed' text from contract() and from the tool description.
- Fixed in: 4b4c332, 27fffa4: a v8 command contract is stored under the name the splitter gives it; COMMAND_WORD and its refusal are gone.

### R9-splitter/record-1: done() refuses three runs of a command contract's own file: a run counts only when argv[0] is the contract's name or its declared run
- drift, `src/validations.js:374`
- Owner (2026-10-16 05:50; 2026-10-16 16:59; 2026-10-16 20:38): there must 3 different examples for each contract || only to contracts that are called or run || e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it
- Required: Count three different runs of a command toward that command when the splitter declares that they serve it. The splitter's own serves statement and its run as written count, with no runtime test of argv[0] against the contract's name.
- Fixed in: aa7098d: a command's three examples are those of the checks the splitter declares as serving it; exercises() and its argv[0] test are gone.

### R9-splitter/record-2: A route's examples count only if its path parameters are written ':x' or '{x}': a route named in another framework's form (e.g. 'GET /items/<id>') can never reach three examples
- drift, `src/validations.js:364`
- Owner (2026-10-15 05:16 / 05:17; 2026-10-16 05:50): 1. more code that just js. Any code type. should be adrogenous || there shouldn't be any version pinning or code type pinning or specific prompt pinning. || there must 3 different examples for each contract
- Required: Don't decide whether a request exercises a route by a runtime-chosen parameter syntax. Count the requests the splitter declares as serving the route, or accept whatever path form the route was declared in, so any language's route spelling can complete the level.
- Fixed in: aa7098d: a route's three examples are those of the checks the splitter declares as serving it; requests() and its :x / {x} grammar are gone.

### R9-splitter/record-3: Texts the splitter reads tell it about other agents: 'the review judged' (every retry) and 'the level ... goes to one worker'
- drift, `src/prompts.js:168`
- Owner (2026-10-16 05:47): shared...princples...after I say "agents shouldn't know that any other agents exist...over...and over...and over...again. What the fuck is the point of a principles file
- Required: Rewrite the splitter's retry and function-result texts so they describe only its own division and what it still needs: for example, that its previous division was not valid or had pieces too small, and that the level holds no division when the room has room for fewer than two pieces. Name no reviewer and no worker, and update the test that pins the wording.
- Fixed in: 27fffa4: the retry and piece texts describe only the splitter's own division (no review, no worker); prompt-lint pins it.

### R9-worker/code-1: The builder's own file takes the place of a worker's delivered file at the contract's path, so the contract ships and is checked as builder-written code
- drift, `src/index.js:3838`
- Owner (2026-10-16 05:21): worker - writes code. only agent that writes code ... builder - writes glue between the interfaces created by the worker. can edit interface names
- Required: The file at a contract's path must stay the worker's delivered file, with the builder's renames applied. The builder's own files are glue beside the workers' files and never take the place of a worker's delivery. The write_file text must stop telling the builder that its file replaces a delivered one.
- Fixed in: 53531d6: the file at a contract's path stays the worker's delivery (with the builder's renames); a builder's file written there goes in the builder's own folder, and the write says where.

### R9-compiler/chrono-1: Call adapter and box runner comments say a check's args, expected values and steps are never shown to the agents that write the code, but the owner ruled that the worker's examples are built from the validations
- record, `container/adapters/call.mjs:23`
- Owner (2026-10-16 05:49 / 05:50): the worker doesn't get validations. The example sohuld be built from the validation. || there must 3 different examples for each contract
- Required: Rewrite these comments to say what the owner ruled and the code does: the worker sees each validation rendered as its examples, including the calls, arguments and expected values. Drop the 'never shown' rationale, together with the protocol it defends if the owner rules on R3-compiler/code-4.
- Fixed in: e70a2a3: the adapter and runner comments say the worker sees the validations as its examples; the guard does not rest on the check being hidden (the protocol itself waits on the owner).

### R9-compiler/code-1: A command check's 'exactly' stdout is loosened by the box: CRLF becomes LF, trailing whitespace is dropped, and box paths are rewritten before the comparison
- drift, `container/build-runner.mjs:841`
- Owner (2026-10-16 20:38): e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it
- Required: Compare the program's raw standard output to the splitter's expect.stdout exactly as written, with no runtime normalisation or rewriting before the assertion, so that the check asserts only what the validation and its example state.
- Fixed in: 911a65a, d97c86e: a command check compares the raw stdout with expect.stdout exactly; no CRLF or trailing-whitespace normalisation.

### R9-compiler/code-3: hostname.py says the room classifies a check that failed under the platform's host name as infrastructure, but no such classification exists
- record, `container/box/hostname.py:26`
- Owner (2026-10-16 05:08): can everything here just get a base16 name? things should still be named manager or whatever, but just name it manager actually root is deprecated by design anyway, it should be manager-hex16 give boxes a hex16 name as well
- Required: Rewrite the comment to say what the code does: the box runs under its hex16 name. When the name cannot be set, the inventory reports that, and nothing reclassifies a check's failure.
- Fixed in: 2ff37af: hostname.py says the inventory reports the name, and nothing reclassifies a failure.

### R9-compiler/record-2: The box rewrites what the deliverable printed (runner paths replaced by '.', '<work>' or bundle-relative paths) before it checks stdout and stderr and before it reports the complaint
- extra, `container/build-runner.mjs:835`
- Owner (2026-10-16 05:39): text heuristics - I don't understand what this is for. Like architecturally, this is protecting from someting that shouldn't happen.
- Required: Compare each expectation against the output exactly as the process printed it, and pass that output to the worker unchanged as the compiler observed it. Drop the redaction and the test that pins it.
- Fixed in: 911a65a: the box compares and reports what the process printed, as printed; redactPaths and the path rewriting are gone.

### R9-edges/chrono-1: A benchmark task's room cannot read any link in its prompt: bench rooms start with no self hosts, so the fetch policy throws and every link is refused
- drift, `src/bench-run.js:146`
- Owner (2026-10-15 05:16): 2. I want to be able to point this thing at links and benchmarks, like AI benchmarks
- Required: Treat a benchmark task's room like any other room: give it the deployment's hosts (the bench request's host and SELF_HOSTS) when it starts, so the links in a task's prompt are read the same way a person's prompt's links are.
- Fixed in: d1de1f7: a bench task room starts with the deployment's hosts (the request's and SELF_HOSTS), as /api/run's rooms do.

### R9-edges/chrono-2: Linked pages are fetched one at a time and every part is read by one reader after another, all before the room's manager exists
- drift, `src/fetcher.js:682`
- Owner (2026-10-15 05:16): 3. I think this should be faster, overall. For how distributed it is, it should be pretty snappy and it doesn't feel that way now.
- Required: Read independent links, and the independent parts of a page, at the same time (each reader its own agent, as the room already names them), so the readings of links stop running one after another ahead of the whole room.
- Fixed in: 366133b, d97c86e: a prompt's links, and every part of every page, are read at the same time.

### R9-edges/code-1: Linked pages are refused by a runtime content-type allowlist: a link served as application/javascript, application/yaml, application/pdf and so on is 'not fetched', and a test pins it
- extra, `src/fetcher.js:25`
- Owner (2026-10-15 05:16): 2. I want to be able to point this thing at links and benchmarks, like AI benchmarks
- Required: Read every link the prompt writes that the allowlist lets through, whatever type it is declared as, and do not refuse it by a runtime list of content types. Record as not read only a body that cannot be read at all, with the reason, and change the test that pins the type refusals.
- Fixed in: 335cccd (owner, 2026-10-17, ruling on interfaces): a link is read whatever content type it is served as; only a body that is not text (a NUL in its first 8 KB) is not read.

### R9-edges/record-2: The deployment's SELF_HOSTS list is silently cut to its first 16 entries, and a room keeps only the first 8 self hosts it is given at Start
- extra, `src/index.js:9330`
- Owner (2026-10-17 00:25): it wasn't the question. I don't understand the need
- Required: Take every host the owner lists in SELF_HOSTS, and every host the room is given at Start, with no count picked by the runtime.
- Fixed in: d1de1f7: every SELF_HOSTS entry and every host given at Start is kept (no 16/8 count).

### R9-records/chrono-1: Docs and the dashboard still say v8 builds in any language, although the box runs a fixed list and refuses everything else
- unfixed, `public/index.html:98`
- Owner (2026-10-15 05:16 / 05:17): 1. more code that just js. Any code type. should be adrogenous || there shouldn't be any version pinning or code type pinning or specific prompt pinning.
- Required: Make the dashboard labels and how-it-works say what the box does: it runs a fixed set of languages from its image, and 'Any code type' is waiting on the owner. Keep them that way until the box actually runs any code type.
- Fixed in: f22a323: the dashboard and how-it-works say the box runs its image's languages and "Any code type" waits on the owner.

### R9-records/code-2: rulings.md keeps the removed parsers and path rule (commandArgv, urlPathError, SELECTOR) as helpers that stay in validations.js
- record, `docs/owner/rulings.md:33`
- Owner (2026-10-16 20:38 / 2026-10-16 20:40 / 2026-10-16 05:39): e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it || not parsing the models output, but functions exposed to the models. for every model. For every interaction. || there should be no per command blocklists, there should be no path rules for agents
- Required: Rewrite rulings.md:33 so it no longer lists a parser, selector grammar or path rule as carried over. Name only what is kept (checkSummary and the executability rules), since the owner ruled out runtime parsing of model output and path rules.
- Fixed in: 0e90c45: rulings.md names only checkSummary and the executability rules as kept.

### R9-records/record-2: The benchmark panel says task rooms share 'one executor of the run's pool' of Container slots, but every v8 task room compiles in its own fresh box, and a test pins the text
- record, `public/app.js:713`
- Owner (2026-10-15 15:52): otherwise for testing, they should just get their own little testing box instead of limiting what they can do
- Required: Rewrite the bench-slots text, and the test that pins it, to say what the code does: Rooms at once is capped by the deployment's BENCH_EXECUTORS setting, and each compile of a task room runs in its own fresh box.
- Fixed in: b85fc07: the bench panel says Rooms at once is capped by BENCH_EXECUTORS and each compile runs in its own fresh box.

## Disputed

### R1-chrono-9: Path rules still refuse and lecture workers and splitters
- drift, `src/index.js:9274`
- Owner (2026-10-16 05:39): there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists. || 2026-10-15 15:57: "in general I never want to tell an agent what they can't do. I want it to just simply be archiecturally the only path …
- Required: No path rule refuses what an agent writes or tells it what it can't do. An agent's world is its own repo and what exists, and the runtime's own folders stay outside that world by construction.
- Claude's evidence: Owner 2026-10-17 on group 8: "don't get these, at all". Claude explained: a worker cannot write under .git/ or a path longer than a repository holds because no git commit can hold either (git's own limit, src/validations.js unheldPath, prompts.js records_folder/too_long say so), so it is not a policy, and nothing changes. Earlier: partly fixed (1c65a31: base_note loses "Change one only when your prompt names its path"). The worker's .git/ and over-long path refusal stays (see R4-worker/record-2), waiting on the owner.

### R4-worker/record-2: The worker's write_file still refuses .git and over-long paths, while the changelog, docs and a test title say no path rule exists
- unfixed, `src/worker.js:52`
- Owner (2026-10-16 05:39): there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: No path rule should refuse a worker's write. Anything a repository cannot hold should be outside the worker's world by construction, not a refusal text. Until then, the changelog, docs and test title must not claim there is no path rule.
- Claude's evidence: Owner 2026-10-17 on group 8: "don't get these, at all". Claude explained: a worker cannot write under .git/ or a path longer than a repository holds because no git commit can hold either (git's own limit, src/validations.js unheldPath, prompts.js records_folder/too_long say so), so it is not a policy, and nothing changes. Earlier: partly fixed (1c65a31: base_note no longer tells agents which existing files they may change). Still open: write_file refuses .git/ and over-long paths (unheldPath), because the artifact store, the export and the box cannot hold them; making any path holdable is shared with v7. For the owner.

### R4-compiler/chrono-1: Call checks work only for JavaScript and Python: a function in any other language gets a false 'defines no X a call reaches' complaint
- drift, `src/checks.js:38`
- Owner (2026-10-15 05:16): 1. more code that just js. Any code type. should be adrogenous
- Required: A function contract the box accepts in any language can be called by a check: the box runs the call in that language. The compiler does not report a defined function as missing because the runtime lacks an adapter for it.
- Claude's evidence: Owner 2026-10-17 on where an adapter's real limits go: "what implementation can't be built as json?" Claude answered that only live values (a callback, an interface with several implementations, a file or socket handle) can't be, in Go, Rust, C, C++ and Java, and that it builds nothing for them: by the owner's ruling on unchanged answers ("problem statement failure, not worker or routing failure"), a worker that cannot change anything answers unchanged and the statement goes back to its splitter. Earlier: waiting on the owner (where an adapter's real limit goes: a worker complaint today, infrastructure before, or the person). partly fixed (b707046: the Go, Rust, C, C++ and Java adapters build the file's own structs, classes, enums and single-implementation interfaces from JSON. What JSON cannot express (a function, an interface several types implement) is still the check's observed failure: where that goes waits on the owner.)

### R5-compiler/chrono-2: Function contracts in Go, Rust, Java, C, C++ or shell can never be called by a check; the compiler retries them as infrastructure for ever
- unfixed, `src/checks.js:110`
- Owner (2026-10-15 05:16): 1. more code that just js. Any code type. should be adrogenous
- Required: Any language the box accepts must be callable by a check: the box runs the call in that language, so a function contract in Go, Rust, Java, C or C++ is checked like a JavaScript one.
- Claude's evidence: Owner 2026-10-17 on where an adapter's real limits go: "what implementation can't be built as json?" Claude answered that only live values (a callback, an interface with several implementations, a file or socket handle) can't be, in Go, Rust, C, C++ and Java, and that it builds nothing for them: by the owner's ruling on unchanged answers ("problem statement failure, not worker or routing failure"), a worker that cannot change anything answers unchanged and the statement goes back to its splitter. Earlier: waiting on the owner (where an adapter's real limit goes: a worker complaint today, infrastructure before, or the person). partly fixed (b707046: the Go, Rust, C, C++ and Java adapters build the file's own structs, classes, enums and single-implementation interfaces from JSON. What JSON cannot express (a function, an interface several types implement) is still the check's observed failure: where that goes waits on the owner.)

### R7-compiler/code-1: Call adapter's own limits (a parameter type it cannot build from JSON) go to a worker as a complaint
- drift, `container/build-runner.mjs:975`
- Owner (2026-10-16 19:44): 1 & 2 are not issues with the worker. How woulda complaint conflict with the prompt 3 & 4 are issues with the runtime / routing
- Required: An adapter's inability to call a defined function is the runtime's issue, not a worker's complaint. Fix it in the runtime (the adapter calls the function in its language) rather than sending it to the worker as its failure.
- Claude's evidence: Owner 2026-10-17 on where an adapter's real limits go: "what implementation can't be built as json?" Claude answered that only live values (a callback, an interface with several implementations, a file or socket handle) can't be, in Go, Rust, C, C++ and Java, and that it builds nothing for them: by the owner's ruling on unchanged answers ("problem statement failure, not worker or routing failure"), a worker that cannot change anything answers unchanged and the statement goes back to its splitter. Earlier: waiting on the owner (where an adapter's real limit goes: a worker complaint today, infrastructure before, or the person). partly fixed (b707046: the Go, Rust, C, C++ and Java adapters build the file's own structs, classes, enums and single-implementation interfaces from JSON. What JSON cannot express (a function, an interface several types implement) is still the check's observed failure: where that goes waits on the owner.)

## Closed

### R1-chrono-1: v8 workers still answer in parsed file blocks, not functions
- drift, `src/model.js:722`
- Owner (2026-10-16 20:43): every model should work that way, where the runtime should only be interfaces exposed to the models. not parsing the models output, but functions exposed to the models. for every model. For every interaction.
- Required: The worker, like the splitter, works in a session of functions the runtime exposes (owner: 'for every model. For every interaction'). Remove the file-block and control-block parsers, the format retries and fallbacks, and rewriteFile.
- Closed: round 2 quorum

### R1-chrono-2: Runtime, not Clef functions, walks the tree and routes
- drift, `src/index.js:9085`
- Owner (2026-10-16 20:46): i mean, think about it. worker asks it manager (clef) where does it this go, clef walks up the tree to find it, which is a function || 2026-10-16 20:43: "not parsing the models output, but functions exposed to the models. for every model. For every interaction."
- Required: A manager's turn is Clef choosing among the functions it has, and a walk up the tree is managers calling a function one level up. Remove the runtime's askUp/resolveAsk/routeComplaint/routeChange loops.
- Closed: round 2 quorum

### R1-chrono-3: Runtime writes glue and renames; builder is no agent
- drift, `src/glue.js:259`
- Owner (2026-10-16 05:21): builder - writes glue between the interfaces created by the worker. can edit interface names || 2026-10-16 20:08: "the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them."
- Required: The builder, as an agent working through functions, writes the glue between the workers' interfaces and renames interface names. The runtime writes no glue and makes no renames on the builder's behalf.
- Closed: round 3 recheck (3 of 3)

### R1-chrono-4: done re-adds 'each contract delivered by at most one piece'
- drift, `src/splitter.js:144`
- Owner (2026-10-16 16:14): > Open question: rules 7, 8 and 10–13. Should “one file, one owner” and “every contract delivered by exactly one piece” stay hard rules, or become something Clef judges in its split review? ... you added those yourself.
- Required: Drop the at-most-one-piece rule from done, and stop calling it the owner's in the tool text, the changelog and the test. done's only rule is three different examples for each contract that is called or run. Whether the division is sound is Clef's call.
- Closed: round 3 recheck (3 of 3)

### R1-chrono-6: Full splitter context still holds split_failed; approved changes not made
- drift, `src/index.js:8719`
- Owner (2026-10-17 00:55): why didn't you just..do them? || 2026-10-17 00:53: "are you doing those?" || 2026-10-17 00:25 (on Claude's proposal that a full context start a fresh splitter session continuing from level(), and that each call count against the room's turn budget): "it wasn't the question. I don't understand the need" || 2026-10-16 23:20 (on 'The room now holds with split_failed'): "what?"
- Required: Make both changes the owner asked about. A full context starts a fresh splitter session with the same functions that carries on from level() until done, so nothing is held or handed down. Each call counts against the room's turn budget.
- Closed: round 4 recheck (4 of 4)

### R1-chrono-7: Bench grade does not go back until done by default
- drift, `src/bench-run.js:45`
- Owner (2026-10-16 05:54): > When the room finishes, the benchmark run grades the shipped bundle once, in the harness’s own box. > That grade never goes back into the room: no complaint, no event, no example. why does it not go back? it should go back until done, just like anything else?
- Required: The grader's failure goes back to the room as a complaint until the room is done, like anything else, with no invented round cap.
- Closed: round 4 recheck (3 of 3)

### R1-chrono-8: rulings.md says the grade never enters the room
- record, `docs/owner/rulings.md:130`
- Owner (2026-10-16 05:54): why does it not go back? it should go back until done, just like anything else?
- Required: Record the owner's ruling instead: the grade goes back to the room until done.
- Closed: round 2 quorum

### R1-chrono-10: Runtime enforces worker process: drops files, caps asks, overrides done
- drift, `src/index.js:9352`
- Owner (2026-10-16 20:08): in general though - the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them. like the runtime should only be exposing functions that make other agents visible or show what the workers can do. That's it.
- Required: The runtime only exposes functions and does what they're called with. It doesn't drop the worker's files, cap or filter its asks, or override its done.
- Closed: round 4 recheck (3 of 3)

### R1-chrono-11: Split bar rises with depth: managers judged differently
- drift, `src/index.js:858`
- Owner (2026-10-15 22:22): yeah, I want all of the managers to be exactly the same. || 2026-10-16 05:30: "the top manager shouldn't even know it's a top manager."
- Required: Every manager's split is judged the same way, and nothing depends on its depth.
- Closed: round 3 recheck (5 of 5)

### R1-chrono-12: Worker context clipped: complaint, complaint count, own files
- extra, `src/checks.js:216`
- Owner (2026-10-16 19:41): how is this possible - this is the place where i WANT worker context? || 2026-10-16 05:39: "A manager hands the problem to the worker with the complaint, and the worker fixes it."
- Required: The worker gets every complaint whole and its own files whole, with no runtime clip on worker context.
- Closed: round 3 recheck (3 of 3)

### R1-chrono-13: Invented repair-round and rebuild caps hold the room
- extra, `src/index.js:323`
- Owner (2026-10-16 05:54): it should go back until done, just like anything else? || 2026-10-16 05:39: "But now we have compensating controls to rebuild code that is missing (right?)"
- Required: Repairs and rebuilds go on until done, bounded only by the budget the owner sets.
- Closed: round 3 recheck (4 of 4)

### R1-chrono-14: Invented size caps on a splitter's level
- extra, `src/validations.js:22`
- Owner (2026-10-17 00:25): > The 100-call cap was my own invention. ... it wasn't the question. I don't understand the need
- Required: Remove the caps the owner never asked for. A level's size is bounded only by what the owner set.
- Closed: round 3 recheck (3 of 3)

### R1-chrono-15: What Clef grades is clipped, not the original
- extra, `src/model.js:175`
- Owner (2026-10-16 05:12): the model should be closer to here's the original model here's the pieces is this valid? (without going too small) || 2026-10-16 05:06: "what prompt are you giving clef and what are you giving clef to grade, exactly?"
- Required: Clef grades the original assignment and the pieces as written, unclipped.
- Closed: round 3 recheck (3 of 3)

### R1-chrono-16: v8 docs still describe the card writer, Root and hidden tests
- record, `docs/how-it-works.md:340`
- Owner (2026-10-16 05:27): throw out the fucking card writer. You're too attached to that thing and it needs to be gone. || 2026-10-16 05:16: "no - the manager NEVER writes code." || 2026-10-16 05:54: "it should go back until done, just like anything else?"
- Required: Rewrite the v8 docs to describe what the owner ruled: no card writer, managers that never write code, no hidden tests, and a grade that goes back until done.
- Closed: round 3 recheck (3 of 3)

### R1-chrono-17: Dashboard model hint describes the flipped split order
- record, `public/app.js:514`
- Owner (2026-10-16 05:09): when did this get flipped? the idea is that manager always attempts to flip, and then clef is supposed to decide if that was a valide split
- Required: The text says what the owner described: every manager attempts a split, and Clef decides whether it is valid.
- Closed: round 3 recheck (3 of 3)

### R1-chrono-18: Bench room goal wraps the task prompt with runtime pins
- drift, `src/bench.js:166`
- Owner (2026-10-15 05:17): there shouldn't be any version pinning or code type pinning or specific prompt pinning. tbh that's not prompting should work.
- Required: A bench room's prompt is the task's own prompt, with no runtime-added language, path or library pins.
- Closed: round 3 recheck (3 of 3)

### R1-chrono-19: Builder linking animation removed from the tree
- drift, `public/styles.css:135`
- Owner (2026-10-13 03:15): in the tree - give the builder linking node a tiny scrolling animation left to right
- Required: A builder node that is linking shows a tiny left-to-right scrolling animation in the graph.
- Closed: round 3 recheck (3 of 3)

### R1-record-1: The splitter's role text tells it to propose no pieces, so the splitter rather than Clef decides that a level does not split
- drift, `src/prompts.js:16`
- Owner (2026-10-16 05:09): the idea is that manager always attempts to flip, and then clef is supposed to decide if that was a valide split
- Required: Once the pre-grade lets the level divide, the splitter proposes a division, and only Clef's review decides whether it is valid, with up to two retries. Drop "or none" and "the fewest" from ROLE.splitter, and stop admitting a 0/1-piece answer as a hand-down that bypasses Clef.
- Closed: round 3 recheck (6 of 6)

### R1-record-11: rulings.md still keeps lenient repair and safety rules 'waiting on per-check boxes'
- record, `docs/owner/rulings.md:25`
- Owner (2026-10-16 20:38): e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it
- Required: Delete the lenient-repair and safety-rules clauses from the Flow section, so the record matches the owner's rulings.
- Closed: round 3 recheck (3 of 3)

### R1-record-12: rulings.md lists 'masking of check values' as something that stays
- record, `docs/owner/rulings.md:43`
- Owner (2026-10-16 05:39): text heuristics - I don't understand what this is for. Like architecturally, this is protecting from someting that shouldn't happen.
- Required: Remove 'masking of check values' from the list of what stays.
- Closed: round 2 quorum

### R1-record-15: CHANGELOG-v8.md puts words in quotes that the owner never wrote
- record, `CHANGELOG-v8.md:284`
- Owner (2026-10-16 05:08): can everything here just get a base16 name? things should still be named manager or whatever, but just name it manager actually root is deprecated by design anyway, it should be manager-hex16 give boxes a hex16 name as well
- Required: Quote the owner's words exactly from prompts.md, or paraphrase without quotation marks.
- Closed: round 3 recheck (3 of 3)

### R2-room/chrono-1: Managers can 'extend' their level on an ask, a growth path that preempts the walk-to-the-room archive
- drift, `src/index.js:9023`
- Owner (2026-10-16 05:39): dScope (54 lines), routeFunction, the “uses” planning, carriersOf, the “nobody up to Root covers it, so write it yourself” rule, and the end-of-line growth rule. - actually this fights against another rule that I had. If clef is able to walk up the inference tree to root and not find the scope to root, then kill that agent. But now we have compensating controls to rebuild code that is missing (rig …
- Required: Offer no extend option on an ask. An ask is answered from a contract the children deliver or passed up with ask_parent; one held by no manager up to the room archives the asker, and the compensating controls rebuild only what the archived agent delivered.
- Closed: round 3 recheck (3 of 3)

### R2-room/chrono-2: Invented 'turns without a model' bound holds the room
- extra, `src/index.js:8009`
- Owner (2026-10-15 23:16): no? there should be no stopgaps? ever? || 2026-10-16 05:30: "the room should be able to tell when its done by observing the final compiler. That's it" || 2026-10-16 19:53: "why, I keep commenting that this shouldn't happen, and the runtime keeps introducing failure cases"
- Required: Remove the turns_without_model bound and hold. The room stops only when its compiler observes done or the owner's budget ends; a spinning loop is fixed at its cause.
- Closed: round 3 recheck (3 of 3)

### R2-room/chrono-3: Prompt queue refuses prompts past an invented count and goal length
- extra, `src/index.js:8281`
- Owner (2026-10-15 05:21): oh, and prompt adjustments. I want to be able to queue prompts instead of sending and forgetting || 2026-10-14 20:50: "I put this goal in - getting an error about character limit:"
- Required: Drop the queue-count and effective-goal-length refusals, and the 8000-character clip of the assignment, so queued prompts are taken and applied as the owner sends them.
- Closed: round 4 recheck (3 of 3)

### R2-room/chrono-4: Clef's routing choice reads clipped items and contract lists
- extra, `src/index.js:9041`
- Owner (2026-10-14 06:27): cause clef should just be walking the infernece tree, and with the scope and functions lined out at split time, it should be pretty cut and dry || 2026-10-16 05:06: "what prompt are you giving clef and what are you giving clef to grade, exactly?"
- Required: Give Clef each child's contracts and the complaint, ask or change whole when it chooses a manager's call, with no runtime clip.
- Closed: round 3 recheck (3 of 3)

### R2-room/record-1: Managers read and route on their children's tasks from the design file, which the owner said a manager doesn't need
- drift, `src/index.js:9003`
- Owner (2026-10-16 05:39): Managers rewrite their children's assignments at runtime. - this is why managers are clef. Clef is built to walk the tree and route questions. The builder can know what the original design is from the splitter, sure, but the manager doesn't need to know that, that's why we use an artifact for that.
- Required: The manager routes without the splitter's design. Clef routes on the children's interfaces (their contracts), which the owner said the manager owns (2026-10-16 05:21), not on the piece prompts in the design artifact. The builder is the one that reads the design.
- Closed: round 3 recheck (3 of 3)

### R2-splitter/chrono-1: A worker handed a level whole gets its manager's prompt cut at 2000 characters
- drift, `src/index.js:8800`
- Owner (2026-10-16 05:44): the workers shouldn't know about their siblings. or about the overall project goal. it should be literally getting handed (here is your prompt, okay have fun now) after something decided it shouldnt' split
- Required: When the level does not split, hand the worker its prompt as it was written, with no runtime clip.
- Closed: round 3 recheck (3 of 3)

### R2-splitter/chrono-2: The splitter reads its assignment cut to 4000 characters, and a retry's rejected tasks cut to 300
- extra, `src/index.js:8747`
- Owner (2026-10-17 00:25): it wasn't the question. I don't understand the need
- Required: Give the splitter its assignment and its rejected pieces as written, with no runtime clip. The model's context window is the only bound.
- Closed: round 3 recheck (3 of 3)

### R2-splitter/chrono-3: A worker's example of a command check cuts each input file to 120 characters
- extra, `src/validations.js:344`
- Owner (2026-10-16 05:49): the worker doesn't get validations. The example sohuld be built from the validation.
- Required: Render each example from the whole validation, with the input files as the check gives them, so the worker's example matches what is run.
- Closed: round 3 recheck (3 of 3)

### R2-splitter/code-3: A two-piece split that Clef calls too small gets no retry: the runtime hands it down after one attempt
- drift, `src/index.js:8722`
- Owner (2026-10-16 05:12): literally every manager tries to split, model can retry twice with different split parameter
- Required: Every manager's splitter gets its two retries with a different split parameter whenever Clef says NO. The level is handed down only after the attempts the owner set, not because the runtime concludes early that no division can pass.
- Closed: round 3 recheck (3 of 3)

### R2-splitter/record-2: Clef's split review is fed the one-owner rules Claude invented, as runtime-computed 'division facts'
- extra, `src/model.js:160`
- Owner (2026-10-16 16:14): > Open question: rules 7, 8 and 10–13. Should “one file, one owner” and “every contract delivered by exactly one piece” stay hard rules, or become something Clef judges in its split review? ... you added those yourself.
- Required: Clef's split review gets the original assignment and the pieces, and is asked whether the division is valid. The runtime does not work out and inject Claude's one-file-one-owner or one-contract-one-piece facts, because no prompt asks for them.
- Closed: round 3 recheck (3 of 3)

### R2-worker/chrono-1: A worker's complaint is acknowledged and lost when its turn ends with wait or a full context window
- drift, `src/index.js:9314`
- Owner (2026-10-16 05:39): A manager hands the problem to the worker with the complaint, and the worker fixes it.
- Required: A complaint the worker was handed stays in its view until the worker has answered it (it ends with done). A session that ends with wait or a full context window must not drop it.
- Closed: round 3 recheck (3 of 3)

### R2-worker/chrono-2: Answers to a worker's asks are clipped to 600 characters and only the last 8 are kept
- extra, `src/index.js:6568`
- Owner (2026-10-16 19:41): how is this possible - this is the place where i WANT worker context?
- Required: The worker gets every answer to its asks, whole, with no runtime count cap or character clip on its context.
- Closed: round 3 recheck (3 of 3)

### R2-worker/code-1: Builder's join silently drops worker files in runtime-reserved folders (components/, glue/, .recursive/, any 'memory' segment, public/interfaces.json, package.json)
- drift, `src/index.js:3761`
- Owner (2026-10-16 05:39): there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: The worker's world is its own repo. Every file it writes there is part of what the builder joins, and no path rule silently decides which of its files exist. The runtime's own folders are kept out of that world by construction, not by filtering the agent's files.
- Closed: round 4 recheck (3 of 3)

### R2-worker/code-2: Builder enforces 'one file, one owner': drops a worker's copy of a path another piece places, and keeps the first of two at one path
- extra, `src/index.js:3766`
- Owner (2026-10-16 16:14): > Open question: rules 7, 8 and 10–13. Should “one file, one owner” and “every contract delivered by exactly one piece” stay hard rules, or become something Clef judges in its split review? My fix agent failed to start, so nothing is running. I’ll start it once you say which of 7–13 stay. you added those yourself.
- Required: Remove the runtime's one-file-one-owner drops from the join. Which pieces' files make up the piece is the builder's work and, for the division, Clef's judgement, not a runtime rule that silently discards a worker's file.
- Closed: round 3 recheck (3 of 3)

### R2-worker/record-1: The runtime walks the asker's line and word-matches packages to answer a worker's ask; no manager is asked
- drift, `src/index.js:6512`
- Owner (2026-10-16 20:43): i mean, think about it. worker asks it manager (clef) where does it this go, clef walks up the tree to find it, which is a function || 2026-10-15 22:10: "the manager is the interface for what exists" || 2026-10-16 20:38: "instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever"
- Required: A worker's ask for a package goes to its manager like any other ask. Managers find it by walking the tree through their functions, as the owner described. The runtime does no line walk, word matching or third-party-to-stdlib substitution of its own.
- Closed: round 4 recheck (4 of 5)

### R2-worker/record-3: Broker comments still describe asks parsed from a control block and answered_requests
- record, `src/broker.js:6`
- Owner (2026-10-16 20:40): every model should work that way, where the runtime should only be interfaces exposed to the models. not parsing the models output, but functions exposed to the models. for every model. For every interaction.
- Required: Describe the broker as what it now is: what the worker's ask function returns, with no control block or answered_requests.
- Closed: round 4 recheck (3 of 3)

### R2-compiler/chrono-1: v8 box refuses every package install; packages default to 'none'
- drift, `container/build-runner.mjs:786`
- Owner (2026-10-15 22:12): why are packages not allowed now?
- Required: Allow packages: the compiler's box installs what the code needs, and packages are listed on the row as the owner described (22:11), instead of being refused and redirected to the standard library.
- Closed: round 4 recheck (3 of 3)

### R2-compiler/chrono-3: Runtime parses run output and files package asks on a worker's behalf
- extra, `src/index.js:4089`
- Owner (2026-10-16 20:08): in general though - the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them.
- Required: Stop filing asks for the worker from parsed run output. The complaint goes down as the compiler observed it, and the worker asks for what it needs through its own ask function.
- Closed: round 3 recheck (3 of 3)

### R2-compiler/chrono-4: Hostname/Python failure-text classifier left after boxes got hex16 names
- extra, `src/box.js:84`
- Owner (2026-10-16 05:39): text heuristics - I don't understand what this is for. Like architecturally, this is protecting from someting that shouldn't happen.
- Required: Remove the text-signature classifier. The box is built so that its name and environment are valid by construction, and the compiler reports what it observed.
- Closed: round 3 recheck (3 of 3)

### R2-compiler/chrono-5: Clef judges only up to 24,000 chars of a document, in parts, retried on a cap
- extra, `src/index.js:9401`
- Owner (2026-10-16 05:06): what prompt are you giving clef and what are you giving clef to grade, exactly?
- Required: Clef judges the whole document against the contract as written, unclipped and not chunked, with no invented retry cap.
- Closed: round 3 recheck (3 of 3)

### R2-compiler/chrono-6: File checks are loosened by runtime whitespace and markup matching
- extra, `src/checks.js:171`
- Owner (2026-10-16 20:38): e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it
- Required: Run the splitter's file check exactly as it wrote it, with no runtime reinterpretation. Whether a validation is sound is Clef's call at the split review.
- Closed: round 3 recheck (2 of 3)

### R2-compiler/chrono-7: Compiler holds the room for the person when code has no compile row or was not in the box
- extra, `src/index.js:9466`
- Owner (2026-10-16 05:30): the room should be able to tell when its done by observing the final compiler. That's it
- Required: The room's completion is what the final compiler observes. Remove the person-acceptance hold for files the box did not compile; compiling any language is the box's job, not a reason to hold.
- Closed: round 3 recheck (3 of 3)

### R2-compiler/record-4: Box caps no prompt asked for: 64 checks, 20 steps, 300-char observations
- extra, `container/build-runner.mjs:425`
- Owner (2026-10-17 00:25): > The 100-call cap was my own invention. ... it wasn't the question. I don't understand the need || 2026-10-16 19:41: "how is this possible - this is the place where i WANT worker context?"
- Required: Remove these caps and clips. Every validation and every step the splitter wrote runs, and the worker gets the observation whole.
- Closed: round 4 recheck (2 of 3)

### R2-edges/chrono-2: Source summaries are parsed out of the model's free text, not given through functions
- drift, `src/fetcher.js:704`
- Owner (2026-10-16 20:43): every model should work that way, where the runtime should only be interfaces exposed to the models. not parsing the models output, but functions exposed to the models. for every model. For every interaction.
- Required: The source model, like every other model, works through functions the runtime exposes (for example, one that records a gist or a summary). The runtime does not extract JSON or lines from its reply and has no fallback parsers.
- Closed: round 3 recheck (3 of 3)

### R2-edges/chrono-4: Grader failure sent back 'verbatim' is cut to 900 characters before it reaches the room
- extra, `src/bench.js:400`
- Owner (2026-10-16 19:41): how is this possible - this is the place where i WANT worker context? || 2026-10-16 05:54: "why does it not go back? it should go back until done, just like anything else?"
- Required: Send the grader's observation back to the room whole, as the complaint the worker gets, with no runtime clip.
- Closed: round 4 recheck (3 of 3)

### R2-edges/code-4: Invented caps decide how much of a linked source splitters and workers see
- extra, `src/room-inputs.js:41`
- Owner (2026-10-17 00:25): > The 100-call cap was my own invention. ... it wasn't the question. I don't understand the need || 2026-10-15 05:16: I want to be able to point this thing at links and benchmarks
- Required: Remove these caps so a linked source reaches the agents whole, bounded only by the budgets the owner sets.
- Closed: round 4 recheck (3 of 3)

### R2-records/chrono-1: README's v8 section still describes the card writer, hidden tests and a rename-only builder
- record, `README.md:93`
- Owner (2026-10-16 05:27): throw out the fucking card writer. You're too attached to that thing and it needs to be gone. || 2026-10-16 05:51: "the \"hidden tests\"" / 05:54: "why does it not go back? it should go back until done, just like anything else?" || 2026-10-16 05:21: "builder - writes glue between the interfaces created by the worker. can edit interface names"
- Required: Rewrite the README's v8 section, and the builder sentence, in the owner's terms: no card or card writer, a splitter that states each level, a builder that writes the glue and may rename interface names, and a benchmark grade that goes back to the room until done instead of tests hidden from agents.
- Closed: round 3 recheck (3 of 3)

### R2-records/chrono-2: rulings.md misquotes the owner on managers being Clef
- record, `docs/owner/rulings.md:36`
- Owner (2026-10-16 05:16): managers are clef models (for routing purposes)
- Required: Quote the owner exactly ('managers are clef models (for routing purposes)'), or paraphrase without quotation marks.
- Closed: round 3 recheck (2 of 3)

### R2-records/code-1: Runtime regex over box output decides a piece's failure is 'outside the piece' and rolls it up instead of routing it
- extra, `src/piece.js:135`
- Owner (2026-10-15 22:22): I want each manager, to hand to a builder to put all the interfaces together (as it is today) but as an additional step I would like clef to evalulate if the code is compilable as a piece. || 2026-10-16 20:08: "the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them."
- Required: Whether a piece's failure belongs to the piece or goes up is decided by Clef or the managers' own functions, not by a runtime text heuristic over the box's output. Remove outsideFailure's classification and the test that pins it.
- Closed: round 3 recheck (5 of 5)

### R2-records/record-1: rulings.md says asks that reach the room are held for the person; the owner said the asker is killed (archived)
- record, `docs/owner/rulings.md:61`
- Owner (2026-10-12 23:55 and 2026-10-16 05:41): if it works up to root without finding it, it kills the work (2026-10-12 23:55) || more specifically, archived. You also ignored the second part of that, I noticed (2026-10-16 05:41)
- Required: Take asks out of what the room holds for the person at rulings.md:61. Record the owner's rule there: an ask no one covers up to the room archives the asker, and the compensating controls rebuild what it delivered.
- Closed: round 3 recheck (3 of 3)

### R2-records/record-2: rulings.md says exactly 3 examples, and a defect retry the owner's function ruling replaced
- record, `docs/owner/rulings.md:125`
- Owner (2026-10-16 05:50 and 2026-10-16 20:40): there must 3 different examples for each contract (05:50) || every model should work that way, where the runtime should only be interfaces exposed to the models. not parsing the models output, but functions exposed to the models. for every model. For every interaction. (20:40, answering Claude's proposal that done() returns what the rules still need)
- Required: Record the owner's rule as written: at least three different examples for each contract that is called or run. A shortfall is what done() returns inside the splitter's own session, not an 'exactly' bound or a retry.
- Closed: round 3 recheck (3 of 3)

### R2-records/record-3: rulings.md still keeps 'safety rules' among the rules carried into validations.js
- unfixed, `docs/owner/rulings.md:35`
- Owner (2026-10-16 05:39): there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: Delete 'and safety rules' from rulings.md:35, so the record keeps only what the owner allowed: executability, with no blocklists or path rules.
- Closed: round 3 recheck (3 of 3)

### R3-room/chrono-1: The prompt queue still has an invented 4x-Start-budget turn allowance and a two-failures stop
- unfixed, `src/index.js:8230`
- Owner (2026-10-15 05:21): oh, and prompt adjustments. I want to be able to queue prompts instead of sending and forgetting
- Required: Take and apply the queued prompts as the person queues them. Each run is bounded only by the turn budget the person sets, with no separate queue allowance and no runtime stop after a number of failures.
- Closed: round 5 recheck (4 of 4): queueReady (src/index.js:8040) is complete || runFailed; a failed prompt is finished as failed and kickQueue applies the next one (promptsAfterRun 8068-8074). applyPrompt's run budget is the prompt's own budget or the Start budget (8115). Grep finds no queueOnFail, stopQueue, failure counter or multiplied allowance.

### R3-room/chrono-2: A turn that throws three times is stopped from retrying and the room pauses (an invented 3-strike stopgap)
- extra, `src/index.js:7647`
- Owner (2026-10-15 23:16): no? there should be no stopgaps? ever?
- Required: Remove the three-failure pause and the agent_stuck hold. A failed turn is the runtime's defect, fixed at its cause, and the run is bounded only by the budget the owner sets.
- Closed: round 4 recheck (3 of 3)

### R3-room/code-4: Clef's routing choice is retried on an invented schedule and then holds the room (askClef/clef_blocked)
- extra, `src/index.js:8938`
- Owner (2026-10-16 20:08): in general though - the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them.
- Required: Remove the runtime's own retry schedule and the clef_blocked person hold from the manager's choice, as was done for document judging. The choice is Clef's answer, and an unanswered call is retried within the owner's budget, not turned into a hold.
- Closed: round 4 recheck (3 of 3)

### R3-room/code-5: Settings comment says that when the pre-grade catches, the manager writes its assignment
- record, `src/index.js:292`
- Owner (2026-10-16 05:16): no - the manager NEVER writes code. What's so hard to understand about that?
- Required: Say what the owner ruled: when the pre-grade catches, the manager hands its whole assignment down to one worker. The manager never writes code.
- Closed: round 4 recheck (4 of 4)

### R3-room/record-4: rulings.md and how-it-works still give managers the splitter's tasks, extend for an ask and route_to for an ask
- record, `docs/owner/rulings.md:149`
- Owner (2026-10-16 05:39): The builder can know what the original design is from the splitter, sure, but the manager doesn't need to know that, that's why we use an artifact for that.
- Required: Record the manager's functions as the owner ruled them: children() with labels and contracts only, no tasks; answer, grant or ask_parent on an ask, with archiving at the room; route_to and extend only for complaints and changes.
- Closed: round 4 recheck (5 of 5)

### R3-splitter/chrono-1: The splitter's contract() silently rewrites what the splitter wrote: filler text dropped, 'returns' stripped, any 'none'/'null'/'promise' output turned into 'nothing'
- drift, `src/splitter.js:86`
- Owner (2026-10-16 20:38): e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it
- Required: contract() stores the fields as the splitter wrote them. When a field cannot be stored, the result says why. The runtime does no filler matching, 'returns' stripping or no-value rewriting of the splitter's text.
- Closed: round 4 recheck (3 of 3)

### R3-splitter/code-2: The splitter runs on the worker model, not the manager model the owner kept separate from workers
- drift, `src/index.js:8589`
- Owner (2026-10-14 20:56): can I also change the worker models? manager models one model, clef is one model, workers could be another model.
- Required: Run the splitter on the model the owner kept for what Claude called the manager (the room's manager model setting), and keep the worker model for the workers, who write the code.
- Closed: round 4 recheck (3 of 3)

### R3-splitter/code-3: On every NO from Clef, the splitter is told to give each piece contracts of its own: the one-contract-one-piece rule the owner said Claude made up
- record, `src/index.js:8558`
- Owner (2026-10-16 16:14): > Open question: rules 7, 8 and 10–13. Should “one file, one owner” and “every contract delivered by exactly one piece” stay hard rules, or become something Clef judges in its split review? My fix agent failed to start, so nothing is running. I’ll start it once you say which of 7–13 stay. you added those yourself.
- Required: The retry text says only what Clef observed (the division was judged not valid) and asks for a different division. It does not restate a one-contract-per-piece rule that the owner said Claude added.
- Closed: round 4 recheck (3 of 3)

### R3-splitter/record-3: A validation that serves a contract gives its worker no example unless a name and path match says the check 'exercises' it
- drift, `src/validations.js:380`
- Owner (2026-10-16 05:49): the worker doesn't get validations. The example sohuld be built from the validation.
- Required: Build a contract's examples from every validation the splitter declared as serving it, so the worker sees an example for each validation its files are checked by. The runtime should not decide by matching which declared validations count.
- Closed: round 4 recheck (3 of 3)

### R3-worker/chrono-1: The v8 builder agent gets v7's project-path rule and is told to rename its files
- unfixed, `src/builder.js:52`
- Owner (2026-10-16 05:39): there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: Read the builder's paths the way the worker's are read (as places in its own world) and drop the v7 path rule and its refusal text, so no path rule refuses what the builder writes.
- Closed: round 4 recheck (2 of 3)

### R3-worker/chrono-2: An invented output cap per response (6500 tokens for the worker, 4096 for the builder) cuts off whole-file writes
- extra, `src/worker.js:100`
- Owner (2026-10-16 19:44): 3 & 4 are issues with the runtime / routing
- Required: Don't cap a worker's or a builder's response below what the model's context window allows, so a whole-file write cannot be cut off by a number the runtime picked.
- Closed: round 4 recheck (3 of 3)

### R3-worker/chrono-5: The join still drops a worker's file whose path matches an existing file's apart from letter case
- unfixed, `src/index.js:3706`
- Owner (2026-10-16 05:39): there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: Every file the worker writes in its repo is part of what the builder joins. No path rule removes it, and whatever overlap there is with an existing file is left to the builder and the compiler to judge.
- Closed: round 4 recheck (2 of 3)

### R3-worker/code-2: workerAsk returns 'the answer is final' for any repeated key and never re-sends the ask
- extra, `src/index.js:9190`
- Owner (2026-10-16 20:08): in general though - the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them. like the runtime should only be exposing functions that make other agents visible or show what the workers can do. That's it.
- Required: An ask the worker makes is sent to its manager as made. The runtime adds no rule that an earlier answer is final and does not merge asks by a truncated key.
- Closed: round 5 recheck (4 of 5): askKey (index.js:120) now includes the request id. workerAsk (9027-9043) answers at once only from the broker (the worker's world by name), the worker's own contract, or a package its own row holds. Every other ask goes to sendAsk (9046-9054), as made, with its own key. No answer-is-final rule is left.

### R3-compiler/chrono-1: A level whose piece has no files escalates to the person instead of the compiler's observation going down as complaints
- drift, `src/index.js:9323`
- Owner (2026-10-16 05:39): A manager hands the problem to the worker with the complaint, and the worker fixes it. || 2026-10-16 05:30: "the room should be able to tell when its done by observing the final compiler. That's it" || 2026-10-16 19:53: "why, I keep commenting that this shouldn't happen, and the runtime keeps introducing failure cases"
- Required: Run the level's validations on the empty bundle as on any other, and send what the compiler observed (each file missing) down as complaints to the workers responsible. Don't escalate the level to the person.
- Closed: round 4 recheck (3 of 3)

### R3-compiler/chrono-2: The box's 1600-file / 4 MiB snapshot cap applies to v8 compiles: a large project's largest file gets a complaint, or the room holds
- extra, `src/build-verification.js:10`
- Owner (2026-10-17 00:25): it wasn't the question. I don't understand the need (answering Claude's 'The 100-call cap was my own invention. I'd drop it') || 2026-10-16 19:53: "the runtime keeps introducing failure cases"
- Required: Remove the invented file-count and byte caps from the v8 box snapshot. The compiler compiles the whole bundle, bounded only by what the owner sets.
- Closed: round 4 recheck (3 of 3)

### R3-compiler/chrono-3: An infrastructure hold retries itself 3 times on an invented schedule, then waits for a person
- extra, `src/index.js:4072`
- Owner (2026-10-17 00:25): it wasn't the question. I don't understand the need (answering Claude's admission of an invented cap) || 2026-10-16 05:54: "it should go back until done, just like anything else?" || 2026-10-15 23:16: "no? there should be no stopgaps? ever?"
- Required: Drop the invented retry count and schedule. The compiler runs the checks again until it can observe the result, bounded only by the budget the owner sets.
- Closed: round 4 recheck (3 of 3)

### R3-compiler/chrono-4: The worker's complaint carries only the last line or two of stderr and one frame; frames are capped at 8
- unfixed, `container/build-runner.mjs:856`
- Owner (2026-10-16 19:41): how is this possible - this is the place where i WANT worker context?
- Required: Give the worker the observation whole, as the compiler observed it (the full stderr, stdout and stack), with no runtime excerpting or frame cap.
- Closed: round 5 recheck (3 of 3): The v8 verifyChecks path passes the observation whole: runCommand and callCheck use observation() with full stdout/stderr/stack (build-runner.mjs:698, 819, 949), and framesOf has no frame cap (build-runner.mjs:692; stack-frames.mjs has no slice). deliverComplaint sends item.detail whole (index.js:8770).

### R3-compiler/chrono-5: The browser check still reinterprets what the splitter wrote: role aliases, tiered fuzzy locators and an inserted goto
- unfixed, `container/adapters/browser-check.mjs:81`
- Owner (2026-10-16 20:38): e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it
- Required: Run each browser check exactly as the splitter wrote it, with no aliases, fuzzy tiers or inserted steps. Whether a validation is sound is Clef's call at the split review.
- Closed: round 5 recheck (3 of 3): browser-check.mjs targetLocator uses getByRole, getByLabel, getByPlaceholder and getByText with exact:true, and [name=] as written (lines 84-92). There are no role aliases, no fuzzy tiers and no inserted goto: the page starts blank and a check opens it with goto (line 30).

### R3-compiler/chrono-7: Packages install only for JavaScript and Python; the box drops installs for every other language silently
- unfixed, `src/checks.js:83`
- Owner (2026-10-15 22:12): why are packages not allowed now?
- Required: Allow packages for the code being built: the compiler's box installs what the code needs in whatever language it is written, and packages are listed on the rows as the owner described (22:11).
- Closed: round 6 recheck (3 of 3): Every compile row and the JS and Python rows now have an install (toolchains.js:55, 90, 184, 188, 203, 210, 219, 223, 230, 234, 240). checkPlan sends every row's packages to the box (checks.js:87-90). verifyChecks installs each one and reports it in installed[], including 'no install command' (build-runner.mjs:785-798). recordInstalls records each result and turns a package that did not install in

### R3-compiler/chrono-8: A split's package names are still resolved by a runtime line walk and word lists, granted fresh from the top with no manager
- unfixed, `src/packages.js:70`
- Owner (2026-10-16 20:43): i mean, think about it. worker asks it manager (clef) where does it this go, clef walks up the tree to find it, which is a function || 2026-10-16 20:38: "instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever" || 2026-10-16 20:08: "the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them"
- Required: A package a piece needs is asked of its manager like any other ask, and managers find or grant it through their functions. The runtime does no line walk, word-list matching or standard-library substitution of its own.
- Closed: round 5 recheck (3 of 3): piecePackages (packages.js:80-85) gives a piece only the names its parent's row lists, matched by name. Every other given name becomes an ask. No line walk, word list or heldByName is left.

### R3-compiler/code-1: A worker's ask for a third-party package ends in archive: managers can only grant what a row already holds, and fresh grants are allowlist-gated
- unfixed, `src/index.js:8847`
- Owner (2026-10-15 22:12): why are packages not allowed now? || 2026-10-15 22:11: packages should be listed in the durable object upon creation, same way as interfaces. That way it can have the same hierarchy as interfaces
- Required: Packages are allowed and listed on the rows with the same hierarchy as interfaces. A worker's ask for a package its row lacks is granted down its line and installed by the compiler's box, and it is never archived for asking. No allowlist decides which names count as packages.
- Closed: round 5 recheck (5 of 6): normalizePackages (src/packages.js:16-26) takes any non-empty name and has no name regex or count cap. managerOptions offers every manager a fresh grant of the asked name in each compile row (src/index.js:8693-8698), and grantPackage lists it on the asker's whole line (8843-8852). An ask still ends in archive only when Clef picks ask_parent at every level up to the room. That is the owner's walk-t

### R3-compiler/record-6: Box runner comment still says the room masks a worker's observation against the check's values
- record, `container/build-runner.mjs:466`
- Owner (2026-10-16 05:39): text heuristics - I don't understand what this is for. Like architecturally, this is protecting from someting that shouldn't happen.
- Required: Rewrite or delete the comment so it does not describe masking. The worker gets the compiler's observation as observed.
- Closed: round 4 recheck (3 of 3)

### R3-compiler/record-7: rulings.md keeps 'accept-untested holds' among what stays, after the owner's completion rule removed them
- record, `docs/owner/rulings.md:43`
- Owner (2026-10-16 05:30): the room should be able to tell when its done by observing the final compiler. That's it
- Required: Remove 'accept-untested holds' from rulings.md:43, so the record matches the owner's rule that the room's completion is what the final compiler observes.
- Closed: round 4 recheck (4 of 4)

### R3-edges/chrono-1: Benchmark tasks are pinned to Python and JavaScript; every other language is skipped
- drift, `src/bench.js:149`
- Owner (2026-10-15 05:16 and 05:17): 1. more code that just js. Any code type. should be adrogenous || there shouldn't be any version pinning or code type pinning or specific prompt pinning.
- Required: Load a benchmark task in whatever language it is written in and grade it in the box that runs that language, with no fixed language set in the benchmark loader.
- Closed: round 4 recheck (3 of 3)

### R3-edges/chrono-2: Bench refuses tasks over an invented goal length and an invented input-file size
- extra, `src/bench.js:164`
- Owner (2026-10-14 20:50; 2026-10-17 00:25): I put this goal in - getting an error about character limit: || > The 100-call cap was my own invention. ... it wasn't the question. I don't understand the need
- Required: Drop both skips, so every task the benchmark has is run with its prompt and tests as written, bounded only by the budgets the owner sets.
- Closed: round 4 recheck (3 of 3)

### R3-edges/chrono-3: The splitter sees an existing repo only as a 24 KB clipped digest with runtime-guessed run/test hints; files over invented caps are hidden from every agent
- extra, `src/base.js:375`
- Owner (2026-10-16 05:39; 2026-10-16 20:08; 2026-10-17 00:25): They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists. || the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them. || it wasn't the question. I don't understand the need
- Required: Give the agents the repo they start from as it is: its files exist in their world whole, with no runtime-clipped digest, guessed run/test hints or invented file-count and size caps deciding what they can see.
- Closed: round 5 recheck (3 of 3): The 24 KB digest and the guessed run/test hints are gone. The splitter gets existing_files (path and byte count for every base file, room-inputs.js:208-211, index.js:661, given at index.js:8430) and a read_file that returns any base file whole (readBase passed at index.js:8436, splitter.js readBase, room-inputs.js:219-224). The worker gets the same at index.js:8950/8981. The one per-file limit is 

### R3-edges/code-2: Linked sources: links past the 8th silently ignored; each page cut at 512 KB and all pages at 2 MB
- extra, `src/fetcher.js:18`
- Owner (2026-10-15 05:16): I want to be able to point this thing at links and benchmarks, like AI benchmarks || 2026-10-17 00:25: "it wasn't the question. I don't understand the need" || 2026-10-16 19:41: "how is this possible - this is the place where i WANT worker context?"
- Required: Fetch every link the prompt writes and keep each page whole, so the linked source reaches the agents as it is, bounded only by the budgets the owner sets.
- Closed: round 4 recheck (3 of 3)

### R3-edges/record-2: Bench outcome decided by a regex over the room's error text (INFRA_ERROR) that marks tasks unscored as 'platform failures'
- extra, `src/bench.js:307`
- Owner (2026-10-16 05:39): text heuristics - I don't understand what this is for. Like architecturally, this is protecting from someting that shouldn't happen.
- Required: Drop INFRA_ERROR and the infra_errors/stalled_infra rules. A task's outcome is what the room and the grader observed (complete and graded, failed, or held), with no text heuristic over error messages.
- Closed: round 4 recheck (3 of 3)

### R3-records/chrono-2: Docs still describe the checks_untested hold (Continue accepts unchecked files) that round 2 removed
- record, `docs/how-it-works.md:419`
- Owner (2026-10-16 05:30): the room should be able to tell when its done by observing the final compiler. That's it
- Required: Remove checks_untested and unchecked_accepted from the holds list and the trying-v8 table. The room is done when its final compiler observes it.
- Closed: round 5 recheck (3 of 3): docs/how-it-works.md:420 lists only the escalation, base_confirm and split_capacity holds; docs/trying-v8.md:23-28 has no checks_untested row; no checks_untested or unchecked_accepted text is left in docs/, README or INSTALL (grep). how-it-works.md:402 and INSTALL:334 say a check that could not run is run again on a turn of the budget, with no hold.

### R3-records/chrono-4: trying-v8.md still describes the box-environment failure classifier removed in round 2
- record, `docs/trying-v8.md:87`
- Owner (2026-10-16 05:39): text heuristics - I don't understand what this is for. Like architecturally, this is protecting from someting that shouldn't happen.
- Required: Remove the classifier paragraph. Say only that the box is named validly by construction and that the compiler reports what it observed.
- Closed: round 4 recheck (2 of 3)

### R3-records/chrono-5: README and how-it-works pin v8's languages to Node and Python
- record, `README.md:96`
- Owner (2026-10-15 05:16 / 05:17): 1. more code that just js. Any code type. should be adrogenous || there shouldn't be any version pinning or code type pinning or specific prompt pinning.
- Required: Describe the box as running whatever code type the work is written in, with no fixed language set, and drop the 'only Node and Python' limitation.
- Closed: round 4 recheck (2 of 3)

### R3-records/chrono-8: rulings.md says the builder is unchanged from M3, the runtime linker the owner replaced with a glue-writing builder
- record, `docs/owner/rulings.md:30`
- Owner (2026-10-16 05:21): builder - writes glue between the interfaces created by the worker. can edit interface names
- Required: Rewrite step 7 to say the builder is an agent that writes the glue between the workers' interfaces and may rename interface names, and that the compiler verifies the joined code.
- Closed: round 4 recheck (3 of 3)

### R3-records/code-5: The runtime parses a piece's imports (importClosure, the 'hard fact') to roll validations up without asking Clef whether the piece can run them
- extra, `src/piece.js:139`
- Owner (2026-10-15 22:22): I want each manager, to hand to a builder to put all the interfaces together (as it is today) but as an additional step I would like clef to evalulate if the code is compilable as a piece. If so, test and compile that piece so that compilation can start earlier within its own testing box.
- Required: Have Clef evaluate whether the assembled piece can be compiled and its checks run as a piece, as the owner asked, without a runtime import parser that decides the roll-up before Clef is asked.
- Closed: round 4 recheck (3 of 3)

### R3-records/code-6: Benchmark offers a 'Once' grading mode in which nothing goes back to the room, and rulings.md records it as an option
- extra, `public/index.html:183`
- Owner (2026-10-16 05:54): why does it not go back? it should go back until done, just like anything else?
- Required: The grader's failure always goes back to the room until done. Remove the Once option from the dashboard and the bench API, and remove the 'Grading once ... is an option' sentence from rulings.md:130.
- Closed: round 4 recheck (2 of 3)

### R3-records/record-4: rulings.md says the splitter may propose no division
- record, `docs/owner/rulings.md:21`
- Owner (2026-10-16 05:09): the idea is that manager always attempts to flip, and then clef is supposed to decide if that was a valide split
- Required: Say that pieces are empty only when the pre-grade hands the level down. Otherwise the splitter proposes a division and only Clef's review decides whether it is valid.
- Closed: round 4 recheck (3 of 3)

### R4-room/chrono-1: Only the top manager may grant a new package: a manager's options depend on whether it has a parent
- drift, `src/index.js:8714`
- Owner (2026-10-15 22:22; 2026-10-16 05:30): yeah, I want all of the managers to be exactly the same. || the top manager shouldn't even know it's a top manager.
- Required: Give every manager the same functions on an ask, whatever its depth. No option may depend on whether the manager has a manager above it.
- Closed: round 5 recheck (3 of 3): managerOptions (src/index.js:8684-8702) builds the same ask options at every depth: answer for each contract from a sibling line, grant for each package on m's row, a fresh grant of the asked name in each compile row (8697-8698), and ask_parent. No option checks agentAbove or depth. Only routeAsk's handling of ask_parent at the top archives (8812-8818), which is the owner's walk-to-root rule.

### R4-room/chrono-2: Queued prompts reach the dashboard cut to 1200 characters, and saving an edit writes the cut text back
- drift, `src/index.js:7953`
- Owner (2026-10-15 05:21; 2026-10-14 20:50): oh, and prompt adjustments. I want to be able to queue prompts instead of sending and forgetting || I put this goal in - getting an error about character limit:
- Required: Give the person their queued prompt whole, so a queued prompt is applied as the person wrote and edited it, with no runtime character clip.
- Closed: round 5 recheck (3 of 3): promptsHead (src/index.js:7962-7966) now sends text:r.text whole, and editPrompt and Save store and return the full text. Separately, promptsHead still keeps only the last 60 prompt rows (.slice(-60)). That is a count cap, not a text clip, and is reported below as a new finding.

### R4-room/chrono-3: The run loop wakes a worker that ended its session with wait (nudgeQuiescentLeaf), overriding the worker's own call
- extra, `src/index.js:7640`
- Owner (2026-10-16 20:08): in general though - the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them. like the runtime should only be exposing functions that make other agents visible or show what the workers can do. That's it.
- Required: Remove the nudge. A worker's wait is its own call, and the runtime only exposes functions and does what they are called with. If a wait with nothing to wait for is possible, fix that through what the worker is given, not with a runtime wake.
- Closed: round 5 recheck (3 of 3): drive (src/index.js:7727, 7730) calls nudgeQuiescentManager and nudgeQuiescentLeaf only under !this.v8(). levelManagerTurn (8607-8617) finishes an interrupted admission (finishLevel) and then carries on with the turn instead of returning.

### R4-room/code-3: The v8 prompt head still reports a room-wide repair-round cap ('repair rounds X of Y') that the owner ruled out and that bounds nothing in v8
- record, `src/index.js:7955`
- Owner (2026-10-16 05:54): why does it not go back? it should go back until done, just like anything else?
- Required: Drop room_repair_rounds and room_repair_cap from the v8 prompt head, and remove the 'repair rounds X of Y' note and the ceiling comment, so the record says what the owner ruled: complaints go back until done, bounded only by the person's budget.
- Closed: round 5 recheck (3 of 3): promptsHead (src/index.js:7962-7966) returns only prompts and goal_rev; room_repair_rounds and room_repair_cap are gone. roomRoundCap (7959) is marked v7 and is only read by roundsLeft (5075) in v7 repair waves. public/app.js has no 'repair rounds X of Y'.

### R4-room/record-2: Room comment still says an ask goes to the manager's splitter
- record, `src/index.js:8207`
- Owner (2026-10-16 05:39): If clef is able to walk up the inference tree to root and not find the scope to root, then kill that agent. But now we have compensating controls to rebuild code that is missing (right?)
- Required: Say what the owner ruled: an ask is answered with a contract the children deliver or passed up with ask_parent, and one held nowhere up to the room archives the asker. Never 'to its splitter'.
- Closed: round 5 recheck (3 of 3): The levels overview comment (src/index.js:8185-8188) now says an ask is answered 'with a contract its children deliver, or passes up with ask_parent (an ask held nowhere up to the room archives the asker)'. No comment sends an ask to a splitter.

### R4-splitter/chrono-1: Splitter's responses are capped at an invented 8192 output tokens, while the worker's and builder's caps were lifted
- extra, `src/splitter.js:187`
- Owner (2026-10-17 00:25; 2026-10-16 19:44): it wasn't the question. I don't understand the need (answering Claude's 'The 100-call cap was my own invention') || 3 & 4 are issues with the runtime / routing (4 = 'Its answer was cut off or malformed, so the fix never landed')
- Required: Remove the runtime-picked cap, so the splitter's responses are bounded only by what the model's context window leaves, as the worker's and builder's now are.
- Closed: round 5 recheck (3 of 3): src/splitter.js:200 splitLevel passes maxTokens: Infinity to session(), and SPLITTER_TOKENS is gone. modelRequest (src/model.js:56-60) then sends what the context window leaves (room), or no cap when the model's window is unknown. The worker (worker.js:107) and the builder (builder.js:121) do the same, so the splitter's answers have no runtime-picked cap.

### R4-splitter/chrono-2: Splitter is told it may declare up to max_children pieces, but a division the room cannot create becomes a split_capacity hold for the person
- drift, `src/index.js:8496`
- Owner (2026-10-16 19:53; 2026-10-16 05:30): why, I keep commenting that this shouldn't happen, and the runtime keeps introducing failure cases || the room should be able to tell when its done by observing the final compiler. That's it
- Required: The runtime must not produce this failure case. A division admitted within the bound the splitter was given is created, and nothing is held, so the bound the splitter is told matches what the room can actually create.
- Closed: round 6 recheck (3 of 3): runSplitter tells the splitter max_pieces = room() = min(maxChildren(), piecesRoom(id)) (src/index.js:8446-8447). piece() reads s.room() live (src/splitter.js:128-129). done takes the division in the same step (takePieces, src/splitter.js:212, src/index.js:1547), and admitLevel reserves the spawn before it releases the take (src/index.js:8500-8501). reserveSpawn's sum (1740) is the same as piecesR

### R4-splitter/code-2: Clef's split review adds questions the owner never described: a scope question for each piece, and exercises/implementable/internal 'doubt' questions for each validation (internal chosen by a runtime file-type heuristic)
- extra, `src/model.js:168`
- Owner (2026-10-16 05:12): the model should be closer to here's the original model here's the pieces is this valid? (without going too small) <----this is the critical part for clef that will require tuning; also 2026-10-15 20:28: "why is clef doubting requirements for the code"
- Required: The split review asks only what the owner described: given the original assignment and the pieces, is this a valid division, and are the pieces not too small. Drop the per-piece scope questions, the per-validation exercises/implementable/internal questions, the internalCandidate heuristic and the doubt marks in holds. Stop calling the review when there are no pieces.
- Closed: round 5 recheck (3 of 3): reviewLevel (src/model.js:149-163) sends Clef {assignment, contracts, pieces} and asks only split_valid and split_size. splitStep calls it only when divide is true (index.js:8389-8394), and done then requires two or more pieces (splitter.js:157-158). grep finds no internalCandidate, VALIDATION_DOUBT, CLEF.scope or exercises/implementable questions in src/ or public/.

### R4-splitter/record-3: split_attempts keeps only the last 24 records, so the pre-grade and the attempt count can drop off and Clef grades again or retries more than twice
- extra, `src/index.js:1499`
- Owner (2026-10-16 05:13): there should also be a catch for "way out of bounds" e.g. pre-grading e.g. grade once -> clef rates "this doesn't need to be split" with a very high certainty, that doesn't need more model turns; also 2026-10-16 05:12: 'literally every manager tries to split, model can retry twice with different split parameter'
- Required: Keep every split attempt of the row's task, so Clef pre-grades a manager once and each division gets exactly the two retries the owner set, with no runtime window deciding either.
- Closed: round 5 recheck (3 of 3): recordAttempt (src/index.js:1501) appends every entry with no slice. splitAttempts (1500) filters only by the row's current task key, so attempt 0 (the pre-grade, read at 8369 and 8375) and the attempt count (tried, 8379) never drop off. SPLIT_ATTEMPTS = 3 (index.js:297) gives the first try and two retries.

### R4-worker/chrono-1: Worker's ask tool still says an ask 'asked and answered before, is answered at once', the removed answer-is-final rule
- unfixed, `src/prompts.js:109`
- Owner (2026-10-16 20:08): in general though - the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them. like the runtime should only be exposing functions that make other agents visible or show what the workers can do. That's it.
- Required: Rewrite the ask description to say what the function does now: the ask is sent as made, and only something available by name is answered at once. Drop the 'asked and answered before' clause.
- Closed: round 5 recheck (6 of 6): prompts.js:111 TOOLS.worker.ask now reads 'Each ask is sent as you make it, and the result says it is sent: its answer arrives at the start of your next turn. Something available by name is answered at once.' The 'asked and answered before' clause is gone, and MESSAGES.ask_sent (prompts.js:176) matches what sendAsk returns.

### R4-compiler/chrono-3: Invented box time caps (200 s per verification, 20 s per check, 5 s per step) turn the box's clock into complaints against workers
- extra, `container/build-runner.mjs:423`
- Owner (2026-10-17 00:25): it wasn't the question. I don't understand the need
- Required: Drop the invented time caps, so a check is bounded only by what the owner sets. A check that times out on the runtime's own clock is not sent to a worker as their failure.
- Closed: round 6 recheck (2 of 3): The v8 verification has no time of its own any more. checkLimits takes limits.total_ms from the request (build-runner.mjs:468-472). Every execCheck in verifyChecks uses ms:left() of that deadline (761-834, 962), and the adapters end at deadline_ms (browser-check.mjs:53, http-check.mjs:82). boxTimes derives ready, exec and life from it (box.js:41-45). Its source is the room's check_seconds setting,

### R4-compiler/chrono-4: The box's syntax stage word-matches file names in compiler output to decide whom to blame, and blames the first file when the output names none
- extra, `container/build-runner.mjs:782`
- Owner (2026-10-16 05:39): text heuristics - I don't understand what this is for. Like architecturally, this is protecting from someting that shouldn't happen.
- Required: Report the syntax step's output as the compiler observed it, and leave who must fix it to routing (the managers' functions). The runtime does not guess the site by matching names in the output.
- Closed: round 5 recheck (3 of 3): The syntax stage runs one process per row and pushes {files, toolchain, stage, detail} with the whole stdout/stderr (build-runner.mjs:786-800). No name matching decides blame, and checkProblems gives such an issue no party (checks.js:154-155).

### R4-compiler/code-1: When Clef gives no answer on whether a piece can run a check, the runtime decides for it and rolls the check up for good (after an invented retry-once schedule)
- extra, `src/index.js:4020`
- Owner (2026-10-15 22:22): I want each manager, to hand to a builder to put all the interfaces together (as it is today) but as an additional step I would like clef to evalulate if the code is compilable as a piece. If so, test and compile that piece so that compilation can start earlier within its own testing box. || 2026-10-16 20:08: in general though - the runtime shouldn't be enforcing any sort of process or doing any o …
- Required: Whether a piece can run a check is Clef's call. When Clef gives no answer, ask it again within the owner's budget, as is done for document judging. Don't treat a missing answer as a NO, and don't move the check up because of one.
- Closed: round 5 recheck (3 of 3): In pieceScope, a check Clef did not answer on is returned as unjudged and is not rolled up (index.js:4041-4046). compileLevel records it as infrastructure 'not run' (index.js:9181), and with no items the compiler runs again on a turn of the budget (index.js:9224-9237). The next run asks Clef again because nothing is cached for it. pieceReach makes one call per group with no retry schedule (model.j

### R4-compiler/record-2: Call adapters and the HTTP client clip the observation the worker reads (stack 4000 chars, load error 2000, 12 names, 2 MB body)
- unfixed, `container/adapters/call.mjs:56`
- Owner (2026-10-16 19:41): how is this possible - this is the place where i WANT worker context?
- Required: Pass the stack, error and response through whole, so the worker's complaint is what the check observed with no runtime excerpting.
- Closed: round 5 recheck (3 of 3): call.mjs emits error and stack whole (stackText returns e.stack; no slice) and lists every exported name (lines 76-77, 126-128). http-check.mjs returns res.text whole as the body. grep finds no clip or slice in call.py, call.rb or call.php apart from argument handling.

### R4-compiler/record-3: Browser checks still loosen what the splitter wrote: fuzzy text in expect_count and a rewritten input selector
- unfixed, `container/adapters/browser-check.mjs:209`
- Owner (2026-10-16 20:38): e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it
- Required: Run every browser step exactly as written (exact text, the selector as given). Whether a validation is sound is Clef's call at the split review.
- Closed: round 5 recheck (3 of 3): expect_count builds a RegExp of the text with no 'i' flag (browser-check.mjs:212). expect_element compares raw innerText with includes (line 141). targetLocator uses the fields as given with exact:true (lines 84-92). No ATTRIBUTE_DEFAULTS and no whitespace folding.

### R4-compiler/record-4: A worker's package ask is still only grantable in npm/pip/gem languages and only for names a regex accepts; otherwise it ends in archive
- unfixed, `src/index.js:8715`
- Owner (2026-10-15 22:12 / 22:11): why are packages not allowed now? || packages should be listed in the durable object upon creation, same way as interfaces. That way it can have the same hierarchy as interfaces
- Required: Grant any package a worker asks for down its line, whatever language it is in, and have the compiler's box install it. A worker is never archived for asking for a package, and no name filter decides what is a package.
- Closed: round 5 recheck (5 of 6): The managerOptions comment (src/index.js:8693-8696) and the routeAsk comment (8797-8802) both say any manager may grant the asked name new, in any language the box compiles. The code matches: compileRows minus text (8698), with no language list or name filter.

### R4-compiler/record-5: Packages install only for JavaScript, Python and Ruby; other languages' packages reach the box and are not installed
- unfixed, `src/toolchains.js:162`
- Owner (2026-10-15 22:12): why are packages not allowed now?
- Required: The compiler's box installs the packages the code needs in whatever language the code is written.
- Closed: round 6 recheck (3 of 3): Packages now install for every row the box has, not only JS, Python and Ruby. C, C++ and shell install through APT_INSTALL (toolchains.js:170-174, 188, 219, 223), Go through go get (:203), Rust through cargo (:210), Java through mvn (:230) and PHP through composer (:240). The box runs each one (build-runner.mjs:785-798), and a failure becomes a complaint (index.js:776-779).

### R4-compiler/record-8: judgeRuns comment still says a Clef error holds the room until Continue
- record, `src/index.js:9112`
- Owner (2026-10-15 23:16): no? there should be no stopgaps? ever?
- Required: Say what the code does: a judgement Clef could not give is run again by the compiler, a turn of the owner's budget each time.
- Closed: round 5 recheck (3 of 3): judgeRuns' comment (index.js:9101) says a judgement Clef could not give is infrastructure and the compiler runs it again on a turn of the room's budget each time. This matches the code (index.js:9105-9107 and 9224-9237).

### R4-edges/chrono-1: Dataset fetch retries a rows page on an invented schedule (500 ms, 1500 ms), picks what to retry by a regex over error text, then silently runs a partial benchmark
- extra, `src/bench.js:249`
- Owner (2026-10-15 23:16): no? there should be no stopgaps? ever?
- Required: Drop the runtime's retry schedule, the error-text regex and the silent partial dataset. The benchmark is loaded as it is, or the run says plainly that it could not be read.
- Closed: round 5 recheck (3 of 3): fetchDataset (bench.js:245-290) reads each rows page once. A page that fails throws FetchRefused naming the offset (bench.js:278-279), and the dataset fails as a whole (bench.js:286-288). PAGE_RETRY_MS, the sleep parameter, the error-text regex and the partial result are all gone (commit 05511d1 diff).

### R4-edges/chrono-2: Benchmark size is capped by invented limits: at most 500 tasks, a 16 MB fetched dataset, a 4 MB pasted one
- extra, `src/bench.js:25`
- Owner (2026-10-15 05:16): 2. I want to be able to point this thing at links and benchmarks, like AI benchmarks
- Required: Remove the runtime's task-count and dataset-size ceilings, so a benchmark the person points at is loaded whole. It is bounded only by the limit and budget the person sets.
- Closed: round 6 recheck (3 of 3): BENCH_LIMITS now holds only pageRows 100 (the rows API page size), concurrency and budget (src/bench.js:28-31). There is no maxTasks, datasetBytes, inlineBytes or timeoutMs. loadTasks stops only at the person's limit, or never (bench.js:203). fetchDataset reads each body with readCapped(body, Infinity) (bench.js:256) and pages until want or the table's end (265-276). benchRoute accepts any limit f

### R4-edges/chrono-3: Bench marks a task 'error' after an invented 5 failed polls of its room (MAX_POLL_ERRORS)
- extra, `src/bench-run.js:47`
- Owner (2026-10-15 23:16): no? there should be no stopgaps? ever?
- Required: Remove the strike count. A room that cannot be read this tick is read again on the next, and the task's outcome is what the room and the grader observe.
- Closed: round 5 recheck (3 of 3): MAX_POLL_ERRORS and the poll_errors column are gone. In tick(), a benchSummary that throws is just skipped ('A room that could not be read this tick is read again on the next', bench-run.js:121-127). The tasks table has no poll_errors column (bench-run.js:64-67).

### R4-edges/code-4: Base repo loader decides by path-name and extension lists which files exist for the agents (vendored dirs, binary extensions, case twins)
- extra, `src/base.js:24`
- Owner (2026-10-16 05:39): there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: Keep the repo's files as they are in the agents' world, with no runtime list of directory names, extensions or case rules deciding which files are the project's. Binary content (detected as such) is the only thing that cannot be text.
- Closed: round 6 recheck (3 of 3): fetchGithubRepo (src/base.js:208-239) has no list of vendored directories, no binary-extension list and no case-twin rule. Content that is not text (a NUL byte, or not UTF-8) is carried as bytes (230-232). keepBaseFiles (src/room-inputs.js:87-99) carries or skips a file only for boxPathError, a NUL byte or the 2 MB storage row. The sanitizeText path skip at base.js:220 is the part R5-edges/code-1 

### R4-records/chrono-1: how-it-works says the v8 splitters run on the worker model
- record, `docs/how-it-works.md:510`
- Owner (2026-10-14 20:56; 2026-10-16 05:16): can I also change the worker models? manager models one model, clef is one model, workers could be another model. || (05:16) managers are clef models (for routing purposes) workers are a different model.
- Required: Say that in a v8 room the splitters run on the manager model and only the workers run on the worker model, matching the owner's split of manager and worker models.
- Closed: round 5 recheck (3 of 3): docs/how-it-works.md:509 now says that in a v8 room the splitters and builders run on the manager model, only the workers run on the worker model, and the link reader runs on the compiler model. INSTALL:185 says the same, and it matches src/index.js:8436 (inferenceEnv('splitter')).

### R4-records/chrono-3: INSTALL doc still describes checks_blocked: a self-retry on 30 s / 2 min / 10 min, then a wait for Continue
- record, `INSTALL-CLOUDFLARE.md:324`
- Owner (2026-10-15 23:16; 2026-10-17 00:25): no? there should be no stopgaps? ever? || it wasn't the question. I don't understand the need
- Required: Remove the checks_blocked retry-schedule text. Say that a check that could not run is run again until the compiler can observe it, within the room's turn budget, with no hold for the person.
- Closed: round 5 recheck (3 of 3): There is no checks_blocked text and no 30 s / 2 min / 10 min schedule left in INSTALL-CLOUDFLARE.md (grep). INSTALL:334 says a check that could not run is run again until it can be observed, each run a turn of the budget, with no hold.

### R4-records/chrono-4: INSTALL doc pins invented limits: an 8-4000 character goal, 400-file/2 MB and 200-file/4 MB base caps, a 30-minute bench task timeout
- record, `INSTALL-CLOUDFLARE.md:265`
- Owner (2026-10-14 20:50; 2026-10-17 00:25): I put this goal in - getting an error about character limit: || it wasn't the question. I don't understand the need
- Required: Describe the limits v8 actually has: no goal-length limit for a v8 goal, no file-count or byte caps on a base beyond Cloudflare's row size, and no bench task timeout. Each run is bounded only by the budgets the owner sets.
- Closed: round 5 recheck (2 of 3): INSTALL:268 says a v8 goal has no upper limit (4000 is v7 only). INSTALL:128 says the room sets no count or size on a repo beyond the 2 MB row. INSTALL:283 says a task has no time limit. The limits this item named are gone. A separate stale bench task cap is reported below as a new finding.

### R4-records/chrono-6: rulings.md puts altered words inside quotation marks as the owner's
- record, `docs/owner/rulings.md:142`
- Owner (2026-10-16 20:43; 2026-10-16 05:30; 2026-10-16 05:44; 2026-10-16 05:49): i mean, think about it. worker asks it manager (clef) where does it this go, clef walks up the tree to find it, which is a function
- Required: Quote the owner's words exactly as prompts.md has them, typos included, or paraphrase without quotation marks.
- Closed: round 6 recheck (3 of 3): I ran a script over every double-quoted string in docs/owner/rulings.md. Every passage attributed to the owner is in prompts.md word for word and sits on its own date: rulings.md:7 (05:16, 05:17), :8 (05:21), :22 (2026-10-16 05:12 and 2026-10-15 20:28), :55, :59, :102, :115, :122, :128, :130, :134, :140, :147. The only quote that does not match character for character is the 05:12 passage, where '

### R4-records/code-1: INSTALL-CLOUDFLARE.md still documents the checks_untested hold that Continue accepts
- unfixed, `INSTALL-CLOUDFLARE.md:324`
- Owner (2026-10-16 05:30): the room should be able to tell when its done by observing the final compiler. That's it
- Required: Remove checks_untested from INSTALL-CLOUDFLARE.md:324. The room is done only when its final compiler observes every validation passing.
- Closed: round 5 recheck (3 of 3): There is no checks_untested left in INSTALL-CLOUDFLARE.md (grep). The troubleshooting entry at INSTALL:334 describes a check that could not run as run again on a turn of the budget, with no hold. INSTALL:333 says the room is done only when its compiler observes every validation passing.

### R4-records/code-3: INSTALL-CLOUDFLARE.md documents the bench feedback 'once' mode in which nothing goes back to the room
- record, `INSTALL-CLOUDFLARE.md:281`
- Owner (2026-10-16 05:54): why does it not go back? it should go back until done, just like anything else?
- Required: Remove `feedback`/`once` (and the stale task timeout) from the API docs. A failed grading always goes back to the room as a complaint until done.
- Closed: round 5 recheck (3 of 3): The INSTALL:283 bench API has no feedback, once, until_done or task_timeout_minutes. It says a failed grading always goes back to the task's room until the task passes or the budget is spent, and that a task has no time limit.

### R4-records/code-4: INSTALL-CLOUDFLARE.md says v8 workers write files in Node or Python
- record, `INSTALL-CLOUDFLARE.md:191`
- Owner (2026-10-15 05:16): 1. more code that just js. Any code type. should be adrogenous
- Required: Drop 'in Node or Python'. Say the box runs whatever code type the work is written in, as README.md:96 now does.
- Closed: round 5 recheck (3 of 3): INSTALL:190 says workers write any text file in whatever code type the work is written in (the box runs it, with no fixed set of languages). The text 'in Node or Python' is gone.

### R4-records/record-4: Docs say the base repo's files 'exist whole' in the splitter's world, quoted as data; the splitter gets only each file's path and byte count
- record, `docs/how-it-works.md:427`
- Owner (2026-10-16 05:39): They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: Make the record say what the code does: the splitter sees a listing of path and size, not the files' text. Alternatively, give the agents a way to see the base files in their world, as the owner described, so the doc's statement becomes true.
- Closed: round 5 recheck (3 of 3): how-it-works.md:366 and :426 describe a listing of path and size plus read_file. The function exists: TOOLS.splitter read_file (src/prompts.js:98), splitterCall reads it through s.readBase (src/splitter.js:182), and it is wired in at src/index.js:8436 (readBase: this.readBaseFile). The worker's read_file is at src/worker.js:88 and src/index.js:8981.

### R5-room/chrono-1: Prompt queue view keeps only the last 60 prompt rows, so the head of a long queue disappears and can't be reordered
- extra, `src/index.js:7963`
- Owner (2026-10-15 05:21): oh, and prompt adjustments. I want to be able to queue prompts instead of sending and forgetting
- Required: Return every prompt (at least every queued one) to the dashboard, so the person can see and manage the whole queue they built, with no runtime row cap.
- Closed: round 6 recheck (3 of 3): promptsHead (src/index.js:7986-7989) returns this.promptRows().map(...) for every prompt row with no slice; reorderPrompts (8034-8040) applies an order over the whole queued set. grep finds no slice(-60) left in the prompt code. test/v8-queue.test.js:364 checks that a long queue comes back whole and that a full reorder applies.

### R5-room/chrono-2: Queue and amend refuse any prompt shorter than 8 characters
- extra, `src/amend.js:42`
- Owner (2026-10-14 20:50): I put this goal in - getting an error about character limit:
- Required: Take a queued or applied prompt as the person writes it, with no runtime minimum length (an empty prompt can simply have nothing to apply), and drop the test that pins the 8-character refusal.
- Closed: round 6 recheck (3 of 3): promptText (src/amend.js:42-47) refuses only an empty or whitespace-only text and takes any other text as written. addPrompt, editPrompt and amend (index.js:8010, 8022, 8125) all use it. /api/run takes a v8 goal of any non-empty length (index.js:9349-9350); the 8-4000 limit is v7 only. test/v8-queue.test.js:344 now pins promptText('x') as accepted, and no test pins an 8-character refusal any more.

### R5-room/record-2: Levels overview comment still says anything sent to the room is a hold for the person, though an ask that reaches the room archives the asker
- record, `src/index.js:8173`
- Owner (2026-10-16 05:41): more specifically, archived. You also ignored the second part of that, I noticed
- Required: Say what the owner ruled: an escalation that reaches the room is held, while an ask no manager up to the room holds archives the asker and the compensating controls rebuild what it delivered. Don't say that everything sent to the room is a hold.
- Closed: round 6 recheck (3 of 3): The levels overview comment (src/index.js:8203-8209) now says that an escalation from an agent whose parent is the room is a hold for the person, while an ask that no manager up to the room holds archives the asker (routeAsk) and the compensating controls rebuild what it delivered. That matches routeAsk (8832-8851: archive at the top) and escalate (8812-8823).

### R5-room/record-3: Test comments still say a new package is granted 'from the top', after the owner ruled every manager the same
- record, `test/v8-live4.test.js:9`
- Owner (2026-10-15 22:22): yeah, I want all of the managers to be exactly the same.
- Required: Rewrite the comments to say that any manager on the asker's line may grant the name new, and stop presenting it as the top manager's function.
- Closed: round 6 recheck (6 of 6): test/v8-live4.test.js:5-12 now says an ask for a package goes up the asker's line and that any manager on that line may grant it, from its row or new as asked ('every manager has the same functions'). grep of test/ finds no 'granted from the top' wording. The only remaining 'top manager' strings are v7 problems-unit tests.

### R5-splitter/chrono-1: A splitter session's held offer of agent slots puts a sibling's hand-down into the split_capacity hold for the person
- unfixed, `src/index.js:8476`
- Owner (2026-10-16 19:53): why, I keep commenting that this shouldn't happen, and the runtime keeps introducing failure cases
- Required: No division or hand-down inside the person's agent and depth limits may end in a split_capacity hold. Remove the failure case the runtime's own slot reservation creates, rather than turning it into a hold for the person.
- Closed: round 7 recheck (4 of 4): index.js:1542-1566: piecesRoom(id) subtracts owedSlots(id), which counts one slot for each other live manager with no level, and split_taken for a manager whose splitter's done took a division. takePieces can therefore never take a sibling's hand-down slot. reserveSpawn (1759) runs prod+reserved+owedSlots(parent)+managers+pieces against max_agents. Worked through, a sibling's one-worker hand-down 

### R5-splitter/chrono-2: The splitter's recorded session keeps only its last 200 calls (SPLIT_CALLS_KEPT)
- extra, `src/index.js:299`
- Owner (2026-10-17 00:25): it wasn't the question. I don't understand the need
- Required: Record the splitter session's whole transcript, with no runtime-chosen count.
- Closed: round 6 recheck (3 of 3): splitterRecord (src/index.js:302) stores {reason, rounds, calls: out.transcript, level} with no slice. session() pushes every call with its whole arguments and result (src/session.js:323). SPLIT_CALLS_KEPT appears nowhere in src/. Only the event text is clipped (clip ..., 600 at 8466), and that is a log line, not the record.

### R5-splitter/code-1: The splitter's contract() checks every non-JS/Python function name against both JavaScript's and Python's identifier and reserved-word rules
- drift, `src/contracts.js:289`
- Owner (2026-10-15 05:16 and 05:17): 1. more code that just js. Any code type. should be adrogenous || there shouldn't be any version pinning or code type pinning or specific prompt pinning.
- Required: Judge a function contract's name only by its own language. A function in a language the runtime has no name rule for is stored as written, not held to JavaScript and Python rules.
- Closed: round 6 recheck (2 of 3): contract() (src/splitter.js:83) uses ownNameError for function contracts. ownNameError (src/contracts.js) judges only the row its path's extension selects: that row's identifier with {0,N} turned into * and its own reserved words. With no path, or a row that has no identifier (only the javascript and python rows have one, toolchains.js:34,69), the name is stored as written. The nameError/functionR

### R5-splitter/code-2: contract() refuses JS function names from a v7 linker blocklist (fetch, process, crypto, console, URL…) as 'reserved words', and caps names at 64 characters
- extra, `src/contracts.js:304`
- Owner (2026-10-16 05:39): text heuristics - I don't understand what this is for. Like architecturally, this is protecting from someting that shouldn't happen. || e command denylist, shell-character an - okay, I asked already, but there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture.
- Required: Drop PROTECTED_NAMES and the 64-character caps from the splitter's name checks. contract() stores any name its language accepts, and refuses only for the reasons its interface states.
- Closed: round 6 recheck (3 of 3): The v8 splitter's name check is ownNameError, which does not touch PROTECTED_NAMES; identifierError's PROTECTED_NAMES check (contracts.js:271) is reached only through v7's nameError for functions. ownNameError strips the {0,63} bound (contracts.js:283). Verified by running contract(): 'fetch' and 'console' in a.js are stored, an 80-character JS name is stored, and a 63-character command name is st

### R5-splitter/record-2: Three copies of the same call count as three different examples, because each step's example repeats the steps before it
- drift, `src/validations.js:347`
- Owner (2026-10-16 05:50): there must 3 different examples for each contract
- Required: Count a contract's examples by what differs between them, so three repetitions of one call or request are one example, and done() reports the contract as short until it has three different examples.
- Closed: round 7 recheck (3 of 3): keyedExamples (src/validations.js:367-382) keys each call or http step on the step without its save, and replaces a $name reference with the key of the step that saved it (readsSaved, 347-357). So three copies of one call under different save names give one key. distinct (408) and ownExamples (422-425) count by key, and missingOf (splitter.js:178-183) reports a contract as short until it has three

### R5-worker/chrono-1: A piece's 'uses' is cut to 8 names and run through a name parser before it becomes the worker's list of names it may call
- extra, `src/interfaces.js:403`
- Owner (2026-10-17 00:25): it wasn't the question. I don't understand the need
- Required: Store the uses the splitter declared through piece() exactly as declared, with no count cap and no regex re-parsing, so the worker is given every name its piece may call.
- Closed: round 6 recheck (3 of 3): provision stores a v8 piece's uses as given (src/index.js:1485 `v8?uses:normalizeUses(uses)`); designOf returns them unparsed for v8 (src/index.js:8313); admitLevel hands pieces their declared uses (src/index.js:8498). There is no 8-name cap and no regex parsing on the v8 path. normalizeUses (src/interfaces.js:403) is reached only from v7 callers. splitter.js:139-144 refuses an unknown use and giv

### R5-worker/chrono-2: The builder's write_file refuses any path an existing file holds, with a 'stays as it is' text about a file outside its world
- drift, `src/builder.js:61`
- Owner (2026-10-16 05:39): there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: Drop the held-path refusal from the builder's write_file. Its world is what it is given, and how a file of its own relates to the project's existing files is left to the join and the compiler, not to a refusal text.
- Closed: round 6 recheck (3 of 3): The builder's writeFile (src/builder.js:57-68) has no path rule and no 'stays as it is' text. It stores any rooted path among its own files, and delete_file (69-79) removes one of its own. The open question of whether its file ships at an existing file's path is about the join and is still tracked as R4-worker/code-1 (src/index.js:3829-3833).

### R5-worker/chrono-3: The join silently drops a person's existing file from the shipped bundle when a piece's file matches its path apart from letter case
- extra, `src/index.js:3700`
- Owner (2026-10-16 05:39): there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: Remove the letter-case rule from addCarried. A carried file is left out only where a piece's file holds exactly the same path, and every other existing file ships as it is.
- Closed: round 6 recheck (3 of 3): addCarried (src/index.js:3723-3735) skips a carried file only when `taken.has(r.path)`, which is an exact-path match. caseTwin is gone (grep finds no case folding), and every other existing file ships.

### R5-worker/code-1: The runtime writes the exact reference a worker must use for a callable name: a v7 require('./<name>') line by name (not path), picked by a browser-project heuristic and a reader-language guess
- extra, `src/index.js:8945`
- Owner (2026-10-16 20:08; 2026-10-15 05:17): in general though - the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them. || there shouldn't be any version pinning or code type pinning or specific prompt pinning.
- Required: Give the worker each callable contract as declared (name, path, what it does) and let the worker write its own reference and the builder join it. The runtime should not render import lines, guess the reader's language or a browser project, or tell the worker to copy a reference exactly.
- Closed: round 6 recheck (3 of 3): workerView (src/index.js:8967-8983) gives each callable contract as declared: name, kind, path, does, inputs, outputs, effects (`declared`). grep finds no renderImport, useReferences, browserProject or import_line in src/. referenceLine (index.js:714) survives only in v7 paths (4831, 6622).

### R5-worker/code-3: An ask naming a linked-page part the worker doesn't hold, or an existing file it wasn't granted, is answered 'Nothing is available' by the runtime and never reaches its manager
- extra, `src/broker.js:82`
- Owner (2026-10-16 20:43; 2026-10-12 23:55): i mean, think about it. worker asks it manager (clef) where does it this go, clef walks up the tree to find it, which is a function || I'd add that the searching can work up the tree to find if something is in scope. if it works up to root without finding it, it kills the work
- Required: Answer at once only what the worker's own world holds. Every other ask, including a page part or an existing file it does not hold, goes to its manager, which finds it or passes it up through its functions, as the owner described.
- Closed: round 6 recheck (3 of 3): broker.js classify (lines 73-82) answers locally only a source chunk or a base file in the asker's catalogue; every other name is kind 'contract'. brokerAnswer (index.js:6306-6323) returns false for those and when the room no longer holds a listed item, so workerAsk sends them on through sendAsk (9057-9086). grep finds no noneAnswer and no broker_none.

### R5-compiler/chrono-1: A browser check whose page lacks the element or text it expects is marked infrastructure, so no complaint ever reaches a worker
- drift, `container/adapters/browser-check.mjs:291`
- Owner (2026-10-16 05:39): A Qwen “manager” model decides how to fix problems - literally, only workers write the code. A manager hands the problem to the worker with the complaint, and the worker fixes it.
- Required: When a page does not meet the step the splitter wrote, that is the compiler's observation of the deliverable. It goes down as a complaint, with what the page offered, so the worker fixes it. Only something the box itself could not do counts as nobody's work.
- Closed: round 6 recheck (3 of 3): In browser-check.mjs, a missing target or text is a Miss or Timeout failure with what the page offered (lines 315-320), not infrastructure. Only three cases are marked infrastructure: the time was spent before the check started (:326), the browser could not open a page (:330), or the browser could not restart (:355). build-runner.mjs:1046-1047 passes the adapter's detail on as a failure that goes 

### R5-compiler/chrono-3: Packages granted in C, C++ or shell, and any failed install, are dropped silently: the room never reads what the box installed
- unfixed, `container/build-runner.mjs:771`
- Owner (2026-10-15 22:12): why are packages not allowed now?
- Required: A package granted for the code must be installed by the compiler's box in whatever language the code is written. Where the box cannot install it, that must be observed and reported, not dropped without a word.
- Closed: round 6 recheck (3 of 3): The box installs packages for every row with an install command and reports each attempt in report.installed, including rows with no install command (build-runner.mjs:788, 795). recordInstalls (index.js:768-780) records every entry, logs packages_not_installed, and returns items routed as complaints to the workers whose rows list the packages. compileLevel adds them to the failing items and does n

### R5-compiler/chrono-4: The verification still runs under runtime-picked time caps (200 s total, 240 s exec, 6-minute box) that the owner never set
- unfixed, `src/checks.js:16`
- Owner (2026-10-17 00:25): it wasn't the question. I don't understand the need
- Required: Drop the runtime-picked time caps, so a verification is bounded only by what the owner sets (the room's turn budget).
- Closed: round 6 recheck (2 of 3): checks.js:13-20: the verification's time is check_seconds, a room setting the person sets (ROOM_LIMITS check_seconds [1, 86400], index.js:284; dashboard countSetting('check-seconds'), app.js:496). The box's ready, exec and life times derive from it (box.js:41-45). The runner picks no time of its own (build-runner.mjs:423-437, 468-472). The default of 200 s is only the setting's starting value, as 

### R5-edges/chrono-1: A linked-page ref the splitter gives a piece is dropped or expanded by the runtime at admission, not refused by piece()
- drift, `src/room-inputs.js:191`
- Owner (2026-10-16 20:38 / 2026-10-16 20:40): e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it || (20:40) every model should work that way, where the runtime should only be interfaces exposed to the models. not parsing the models output, but functions exposed to the models. for every model. For every i …
- Required: piece() should check refs against the refs the level holds and, as the owner approved for the splitter's functions, say exactly why one cannot be stored. What the splitter declares should then be given as declared, with no runtime narrowing or prefix expansion at admission.
- Closed: round 6 recheck (3 of 3): piece() refuses a ref its level does not hold and lists the refs it does hold (src/splitter.js:147-149). assignRefs stores the declared refs as they are (src/index.js:671-675), called at index.js:1718. narrowRefs is gone (grep finds nothing).

### R5-edges/chrono-2: An existing repo must download within an invented 30-second deadline, or the run cannot start from it
- extra, `src/base.js:18`
- Owner (2026-10-17 00:25 / 2026-10-16 05:39): it wasn't the question. I don't understand the need (answering Claude's 'The 100-call cap was my own invention') || (05:39) They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: Read the repo whole, with no runtime-picked deadline deciding whether the agents get their starting project. The read is bounded only by what the owner sets.
- Closed: round 7 recheck (3 of 3): src/base.js:11-19 REPO_LIMITS has no time field (maxFileBytes is Cloudflare's 2 MB row limit, maxSkipped only shortens the list of skipped files). fetchGithubRepo (base.js:155-248) has no timer, race or AbortSignal, and the comment at :155 says the repo is read whole with no deadline. loadBase (room-inputs.js:123-148) and start() (index.js:7837) call it directly, with no wrapper that adds a deadli

### R5-edges/chrono-3: A benchmark task whose grader could not run is settled as 'error' and never graded again
- drift, `src/bench-run.js:185`
- Owner (2026-10-16 05:54 / 2026-10-15 23:16): why does it not go back? it should go back until done, just like anything else? || (23:16) no? there should be no stopgaps? ever?
- Required: When the grader could not observe a result, grade the completed room again on a later tick until it can, bounded only by the run's budget. Don't settle the task as an error from one unobserved grading.
- Closed: round 6 recheck (3 of 3): In graded() (src/bench-run.js:179-193), a grading the grader could not run returns after record(), with no round counted and the task left running. tick() grades the completed room again on the next alarm (128), and stop() leaves such a task running so resume grades it (257, 269-276). Nothing settles a task as an error from one unobserved grading. (A stale comment in bench.js is reported as a find

### R5-edges/chrono-4: Deleting a scored benchmark room stops after an invented 10 tries (MAX_PURGE_TRIES)
- extra, `src/bench-run.js:47`
- Owner (2026-10-15 23:16): no? there should be no stopgaps? ever?
- Required: Remove the strike count. A room marked for deletion is tried again on later ticks until the delete goes through, as a room that cannot be read is read again on the next tick.
- Closed: round 6 recheck (3 of 3): MAX_PURGE_TRIES and the tries column are gone (the rooms table is at bench-run.js:71). purgeRooms (234-240) tries every room with purge=1 and purged=0 on each tick. pendingPurges (230) keeps the alarm set while any is left (114, 165, 295).

### R5-edges/code-2: A benchmark dataset must arrive within 30 s in total, or the whole run is refused
- unfixed, `src/bench.js:28`
- Owner (2026-10-15 05:16): 2. I want to be able to point this thing at links and benchmarks, like AI benchmarks
- Required: Load the benchmark the person points at whole. Its size is bounded only by the limit and budget the person sets, not by a deadline the runtime picked for all pages together.
- Closed: round 6 recheck (3 of 3): fetchDataset calls guardedFetch with no race and no signal (src/bench.js:249-250), and readCapped(body, Infinity) (256). BENCH_LIMITS has no timeoutMs (28-31). A dataset is read for as long as reading it takes.

### R5-edges/code-4: Bench decides to retry a task in a fresh room by a regex over the room's error text
- extra, `src/bench-run.js:161`
- Owner (2026-10-16 05:39): text heuristics - I don't understand what this is for. Like architecturally, this is protecting from someting that shouldn't happen.
- Required: Remove the error-text match. A task's outcome is what its room and the grader observe. If a fresh room can report 'already running', fix that cause instead of matching the message.
- Closed: round 6 recheck (3 of 3): The /already running/ requeue is gone. When start() is refused, the task is finished as error, whatever the text (src/bench-run.js:156-159). grep finds no regex over the room's error text deciding a requeue.

### R5-edges/record-4: graderComplaint's comment still describes a bench 'feedback until_done' mode
- record, `src/index.js:8577`
- Owner (2026-10-16 05:54): why does it not go back? it should go back until done, just like anything else?
- Required: Say what the code does: a failed grading always goes back to the room's manager as a complaint until done. Don't name a feedback mode.
- Closed: round 6 recheck (3 of 3): graderComplaint's comment (src/index.js:8604-8608) says a failed grading always comes back as a complaint at the room's manager until a grading passes, bounded by the room's own budget. It names no feedback mode, and that matches the code at 8609-8621.

### R5-records/chrono-1: how-it-works and INSTALL still say files under vendored or generated directories are carried untouched and never built, a path rule the code dropped
- record, `docs/how-it-works.md:424`
- Owner (2026-10-16 05:39): there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: Remove the vendored/generated-directory clause from how-it-works.md:424 and INSTALL-CLOUDFLARE.md:128. A repo's files are in the agents' world as they are; only content that is not text is carried as bytes.
- Closed: round 6 recheck (3 of 3): docs/how-it-works.md:424 now says 'Every regular file is read, whatever its directory' and that only content that is not text is carried as bytes, with 'a repo's own glue/ and .recursive/ files are its files'. INSTALL-CLOUDFLARE.md:128 says the same. A grep for vendor/generated-directory wording in README, docs and INSTALL finds only the Acorn licence lines and one historical CHANGELOG entry (265)

### R5-records/chrono-2: INSTALL documents a benchmark task cap (limit defaults to 20, at most 500) that the code removed
- record, `INSTALL-CLOUDFLARE.md:283`
- Owner (2026-10-15 05:16): 2. I want to be able to point this thing at links and benchmarks, like AI benchmarks
- Required: Rewrite the limit clause to say what the code does: every task in the dataset runs unless the person gives a limit, with no ceiling, so a benchmark the person points at is loaded whole.
- Closed: round 6 recheck (3 of 3): INSTALL-CLOUDFLARE.md:284 says 'limit is optional: without it every task in the dataset runs, and with it the first limit tasks run, with no ceiling'. This matches src/bench.js:203 (cap = Number(limit) >= 1 ? Number(limit) : Infinity). No 20/500 limit text is left.

### R5-records/chrono-3: rulings.md softens 'the manager NEVER writes code' to 'never writes deliverable code'
- record, `docs/owner/rulings.md:7`
- Owner (2026-10-16 05:16): no - the manager NEVER writes code. What's so hard to understand about that?
- Required: Record the owner's rule as stated: a manager never writes code (it writes files such as its level file), and the worker is the only agent that writes code.
- Closed: round 6 recheck (3 of 3): rulings.md:7 now reads 'It never writes code (owner, 2026-10-16 05:16: "the manager NEVER writes code"). It writes files, such as that one (owner, 2026-10-16 05:17: "managers have to write files")'. rulings.md:8 says the worker is the only agent that writes code (05:21). The 'deliverable code' softening is gone.

### R5-records/code-4: Dashboard labels say the manager model makes the decisions and the compiler model writes the runner's test, in v8 rooms too
- record, `public/index.html:56`
- Owner (2026-10-16 05:16): managers are clef models (for routing purposes) workers are a different model.
- Required: Make the model labels describe the room's pipeline as the hint does. In v8, the manager model runs the splitters and builders, Clef makes every manager's choice, and the compiler model reads the linked pages.
- Closed: round 6 recheck (3 of 3): public/app.js:515-519 MODEL_LABELS.v8 relabels the pickers: 'Manager model (the splitters and the builders)', 'Compiler model (reads the linked pages)' and 'Clef model (every manager's choice, the split's pre-grade and review, ...)'. updateModelHint (518-525) applies them whenever the pipeline is v8 and on load. The v7 labels in index.html:59/80 show only for v7 rooms.

### R5-records/record-3: rulings.md dates the owner's 'here's the original model / here's the pieces / is this valid?' ruling 2026-10-15; it was sent 2026-10-16
- record, `docs/owner/rulings.md:22`
- Owner (2026-10-16 05:12): literally every manager tries to split, model can retry twice with different split parameter the model should be closer to here's the original model here's the pieces is this valid? (without going too small) <----this is the critical part for clef that will require tuning
- Required: Give each quote its own date heading from prompts.md: 2026-10-16 05:12 for the split-review quote, 2026-10-15 20:28 for 'why is clef doubting requirements for the code'.
- Closed: round 6 recheck (3 of 3): rulings.md:22 dates the split-review quote 'owner, 2026-10-16 05:12' and 'why is clef doubting requirements for the code' 'owner, 2026-10-15 20:28'. Both dates match the prompts.md headings.

### R6-room/code-1: continueHold's comment says Continue gives the held row a fresh set of split attempts, which nothing does
- record, `src/index.js:8577`
- Owner (2026-10-16 05:12): literally every manager tries to split, model can retry twice with different split parameter
- Required: Make the comment say what Continue does: it clears the holds and wakes the rows they name. Don't describe a reset of split attempts, since the owner gave a split two retries.
- Closed: round 7 recheck (3 of 3): src/index.js:8593-8599: continueHold's comment now says Continue answers a pending grant first, otherwise clears every hold that reached the room and wakes the row each one names, forgets which compile reports and escalations were sent, and reruns a prompt the hold failed. The fresh-split-attempts claim is gone. The code at 8600-8616 does exactly that. split_attempts:<id> is still written only by 

### R6-room/record-2: Start keeps only the first 64 existing-file paths the person grants; the rest are silently dropped and wait at base_confirm
- extra, `src/index.js:7831`
- Owner (2026-10-17 00:25; 2026-10-15 23:16): it wasn't the question. I don't understand the need || (2026-10-15 23:16) no? there should be no stopgaps? ever?
- Required: Take every path the person grants at Start, with no count cap the owner never set.
- Closed: round 7 recheck (5 of 5): src/index.js:7850: start() saves base_approved as [...new Set(grants.filter(p=>typeof p==='string'&&isPath(p)))] with no .slice(0,64). /api/continue (9381) passes every string grant to resume, then continueHold, then confirmBase (5518-5525) with no count cap. Every granted path is kept. The grant gate itself is still the open R2-edges/chrono-1.

### R6-splitter/chrono-1: A rebuild or extend job's hand-down still ends in a split_capacity hold, because archived rows keep their agent slots and a pending job is owed none
- unfixed, `src/index.js:8503`
- Owner (2026-10-16 19:53; 2026-10-16 05:39): why, I keep commenting that this shouldn't happen, and the runtime keeps introducing failure cases || If clef is able to walk up the inference tree to root and not find the scope to root, then kill that agent. But now we have compensating controls to rebuild code that is missing (right?)
- Required: The rebuild the owner relies on as a compensating control must not end in a hold. An archived row should not keep a slot the rebuild needs, and a manager's pending job should be owed its worker the way an unlevelled manager's hand-down is.
- Closed: round 7 recheck (4 of 4): index.js:1524: productionNodeCount leaves out archived rows under v8. reservedSpawnSlots (1510) and owedSlots (1557) skip batches of archived parents. owesWorker (1564) owes a levelled manager a worker while a level_job is pending or while orphansOf finds a contract no live child delivers. A rebuild's hand-down in admitLevel (8520) therefore uses the slot the archived row freed and that was counte

### R6-splitter/chrono-2: contract() still runs v7's JS-shaped signature parser on every function name, so Store::create and similar names in other languages are refused without a reason
- unfixed, `src/contracts.js:125`
- Owner (2026-10-15 05:16; 2026-10-16 20:38; 2026-10-16 20:40): 1. more code that just js. Any code type. should be adrogenous || e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it
- Required: Store a function contract's name as the splitter wrote it, judged only by its own language's rule. Drop the v7 signature parsing from the v8 contract path, and when a name cannot be stored, say exactly why.
- Closed: round 7 recheck (3 of 3): contract() (src/splitter.js:84) checks a function name only with ownNameError (src/contracts.js:276-283). It uses the identifier rule of the row the path's extension names, and only the JavaScript and Python rows have one (toolchains.js:34,69). A Rust, Go or C++ path, or a function with no path, is stored as written. normalizeContract with v8:true goes to contractItem (121-143), which keeps name =

### R6-splitter/chrono-3: A non-top level handed down to one worker keeps validations for contracts the worker is never given, so it gets no examples for checks it is compiled against
- drift, `src/index.js:8496`
- Owner (2026-10-16 05:49; 2026-10-16 05:16): the worker doesn't get validations. The example sohuld be built from the validation. || even if the problem doesn't split, it's still handing it down to a worker
- Required: A level handed down whole goes to the worker whole: the worker gets every contract the admitted level holds, with each example rendered from the validations that serve it, so that every validation its files are checked by reaches it as examples.
- Closed: round 7 recheck (4 of 4): index.js:8515-8517: the one worker a level is handed down to gets interfaces:contracts, meaning every contract of the admitted level. Each contract's serves includes the ids of the level's validations that serve it (8510). workerView (8999) renders each contract's examples from the validations it serves, so every validation of the level reaches the worker as examples.

### R6-splitter/code-1: done() counts other contracts' calls and requests as a contract's three different examples, so a route or function with one example of itself completes the level
- unfixed, `src/validations.js:363`
- Owner (2026-10-16 05:50): there must 3 different examples for each contract
- Required: Give a contract a count of three only from different examples that exercise that contract: steps that call or request it, checks that run it. done() should report it as short until then. The steps before it can stay as the state each example starts from.
- Closed: round 7 recheck (3 of 3): missingOf (src/splitter.js:180-183) counts examplesOf, which is ownExamples (src/validations.js:422-425). For a function, command or route, ownExamples keeps only keyed examples whose 'of' exercises that contract (exercises, 395-405): a call of the function, a request whose method and path match the route, or a run of the command by its name, its own argv or the serve. Steps that call other contra

### R6-splitter/record-1: Clef's piece_reach answers are kept only for the last 200 check/digest keys (slice(-200)), so older answers are dropped and Clef is asked again on the room's budget
- extra, `src/index.js:4067`
- Owner (2026-10-17 00:25): it wasn't the question. I don't understand the need
- Required: Keep every piece_reach answer per check key and piece digest, with no count picked by the runtime.
- Closed: round 7 recheck (3 of 3): pieceScope (src/index.js:4077-4086) reads piece_reach:<id> and saves {...kept,...fresh}, with no slice and no count bound, so every answer per check key and digest is kept.

### R6-splitter/record-3: Three copies of one call or request still count as three different examples when each step saves under a different name
- unfixed, `src/validations.js:318`
- Owner (2026-10-16 05:50): there must 3 different examples for each contract
- Required: Count a contract's examples by what differs in the call or request itself (its function or method and path, its inputs and what it observes), so that repeating one call under another save name does not count as a new example.
- Closed: round 7 recheck (3 of 3): Same code as R5-splitter/record-2. The call/http key drops save, and readsSaved swaps a saved-name reference for the saving step's key (src/validations.js:347-375). Repeating one call or request under another save name gives the same key and counts once.

### R6-worker/chrono-1: A v8 worker that calls wait with nothing outstanding is never woken; the room pauses and Continue cannot restart it
- drift, `src/index.js:9041`
- Owner (2026-10-16 19:53): why, I keep commenting that this shouldn't happen, and the runtime keeps introducing failure cases (also 2026-10-16 05:30: "the room should be able to tell when its done by observing the final compiler. That's it")
- Required: The runtime must not create this dead end. A worker's turn must not be able to end in a state that nothing will wake, so the room never stalls short of what its final compiler observes. Fix it through the functions the worker is given, not with a runtime nudge.
- Closed: round 7 recheck (3 of 3): src/worker.js:37 workerTools leaves wait out unless w.outstanding(). src/index.js:9036 gives outstanding:()=>this.openAsks(id).length>0. session.js:62-65 and :90-91 work out the offered functions every round and at each call, and refuse a call to a function not offered, so a worker cannot call wait with nothing open. If an answer lands while the session is still running, the end of levelWorkerTurn

### R6-worker/chrono-2: The builder's rename accepts only JavaScript-style names and uses JavaScript identifier boundaries, so it cannot rename names in other languages and can corrupt them
- extra, `src/builder.js:28`
- Owner (2026-10-15 05:16): 1. more code that just js. Any code type. should be adrogenous (also 2026-10-16 05:21: "builder - writes glue between the interfaces created by the worker. can edit interface names")
- Required: Let the builder rename an interface name in whatever language the file is written, as that language delimits its names. Drop the runtime's fixed JavaScript character set from both the refusal and the boundary.
- Closed: round 7 recheck (3 of 3): src/builder.js:144-147 wholeName builds its boundary from \p{L}\p{N}\p{M} plus the name_characters the builder passes (rename at :196-206). No JS identifier regex is left on from/to: :202 only requires non-empty text. TOOLS.builder.rename (prompts.js) asks for name_characters 'that the file's language allows inside a name'. Live via pieceBuilderTurn → builderSession (index.js:3922).

### R6-worker/chrono-3: The broker clips what a worker sees of a linked page: the title to 120 characters and the source URL in an answer's label to 500
- extra, `src/broker.js:57`
- Owner (2026-10-16 19:41): how is this possible - this is the place where i WANT worker context? (also 2026-10-17 00:25: "it wasn't the question. I don't understand the need")
- Required: Give the worker the page's title and source as they are, with no character clip chosen by the runtime.
- Closed: round 8 recheck (4 of 4): src/broker.js:57 now builds the catalogue entry as available_source({part, title: sanitizeText(s.title || `S${m[1]}`)}), and broker.js:98 labels a source answer BROKER_LABEL.source(sanitizeText(url)). Neither has a slice or clip. sanitizeText (src/fetcher.js:546-549) normalises characters and does not cut length. The titles map in catalogue() (src/index.js:6304) passes summary.title, title, final_

### R6-worker/record-2: The worker's ask text says anything available by name is answered at once, but a name it may call goes to its manager
- record, `src/prompts.js:113`
- Owner (2026-10-16 20:43): i mean, think about it. worker asks it manager (clef) where does it this go, clef walks up the tree to find it, which is a function
- Required: Make the ask text say what happens: only what the worker's own world holds (its own contracts, its packages, the files and page parts given to it) is answered at once. Every other ask, including one for a name it may call, goes to its manager.
- Closed: round 7 recheck (3 of 3): TOOLS.worker.ask (src/prompts.js:113) now says: what you deliver, your packages, and the existing files and linked-page parts given to you are answered at once; any other ask, a callable name included, is sent and answered next turn. This matches workerAsk (src/index.js:9078-9094): brokerAnswer handles source/base, then the asker's own contract (own_contract), then a package its row holds. Everyth

### R6-compiler/chrono-2: Box start-up retries on an invented schedule (250-1500 ms, 5 tries), chosen by a regex over the error text
- extra, `src/build-executor.js:22`
- Owner (2026-10-16 05:39): text heuristics - I don't understand what this is for. Like architecturally, this is protecting from someting that shouldn't happen.
- Required: Remove the error-text regex and the invented retry schedule from the box's start. A box that does not start is what was observed, handled like any other box failure, with no runtime-chosen count or wording decides whether it is tried again.
- Closed: round 7 recheck (3 of 3): Box.boot (src/box.js:181-186) runs its readiness command ['true'] once and throws BoxError('not_ready') on a non-zero exit. The v8 path has no error-text regex and no retry schedule. The retry loop that remains (build-executor.js:27-36, execAfterStartup) is used only by v7's BuildExecutor.build. index.js:2569 prewarmContainer and 2583 containerRun both return early under this.v8(), so v8 never rea

### R6-edges/chrono-1: Linked pages still fail on an invented 10-second whole-fetch deadline (folded into R5-edges/chrono-2, not fixed)
- unfixed, `src/fetcher.js:22`
- Owner (2026-10-17 00:25): it wasn't the question. I don't understand the need
- Required: Remove the runtime-picked deadline from fetchSource, so a linked page is read whole, as the repo and the dataset now are. Its reading is bounded only by what the owner sets.
- Closed: round 7 recheck (3 of 3): fetcher.js:21-23 LIMITS holds only maxHops. fetchSource (fetcher.js:569-602) and guardedFetch (287-305) have no timeoutMs, race or signal, and maxBytes defaults to Infinity. room-inputs.js loadSources (158-177) and index.js loadSources (691-716) call fetchGoalSources directly with the plain fetcher (index.js:611). A grep for setTimeout/timeout/deadline/AbortSignal/Promise.race finds nothing in fet

### R6-edges/chrono-2: bench.js comment still says an unrunnable grader settles the task as an error, never scored; the code now grades it again on every tick
- record, `src/bench.js:143`
- Owner (2026-10-16 05:54): why does it not go back? it should go back until done, just like anything else?
- Required: Rewrite the comment to say what the code does: a grading that could not run observes nothing and is tried again, so the result goes back until done, as the owner ruled. It does not settle the task as an error.
- Closed: round 7 recheck (3 of 3): bench.js:138-145 now says that for a language no row runs, the grader says so ({unrunnable}), the grading observes nothing, the task stays running and is graded again until done. That matches bench-run.js:179-183: graded() records the costs and returns on an 'error' grade, leaving the task running for the next tick. gradeOutcome's comment (bench.js:326-328) agrees. No comment still says such a tas

### R6-edges/code-2: Bench skips any task whose entry function name is longer than 64 characters or is not a JS/Python-style identifier, whatever the task's language
- extra, `src/bench.js:194`
- Owner (2026-10-15 05:16 / 05:17): 1. more code that just js. Any code type. should be adrogenous 2. I want to be able to point this thing at links and benchmarks, like AI benchmarks || there shouldn't be any version pinning or code type pinning or specific prompt pinning.
- Required: Load the benchmark's rows as written. Use the entry name the row gives, in its own language, with no runtime length cap or JS/Python identifier pattern deciding which tasks exist.
- Closed: round 7 recheck (3 of 3): taskFromRow (bench.js:165-200) takes row.entry_point/row.entry as written (:172, :192), trimmed, with no length cap and no identifier regex. The only skip about the entry is for a Python or JavaScript row that has none (:195). The harnesses regex-escape the entry (bench-harness.js:72, :197, :280). The JS and other-language walks use [\w$] boundaries, which only affect which files count as naming t

### R6-records/chrono-1: INSTALL still says every goal needs at least 8 characters; a v8 goal is taken however short
- record, `INSTALL-CLOUDFLARE.md:269`
- Owner (2026-10-14 20:50): I put this goal in - getting an error about character limit:
- Required: Say that a v8 goal has no length limit (only an empty one is refused), and that the 8–4000 character range applies only to a v7 goal.
- Closed: round 7 recheck (3 of 3): INSTALL-CLOUDFLARE.md:269 now says 'A v8 goal has no length limit: only an empty one is refused. A v7 goal must have 8–4000 characters.' That matches the v8 Start path.

### R6-records/chrono-2: how-it-works says the worker is given 'how to refer to' each name it may call; the runtime no longer renders references
- record, `docs/how-it-works.md:377`
- Owner (2026-10-16 20:08): in general though - the runtime shouldn't be enforcing any sort of process or doing any of the agents work for them.
- Required: Say the worker gets each contract it may call as declared (name, kind, path, what it does, its inputs and outputs) and writes its own reference. Drop 'with how to refer to each' and fix the test comment the same way.
- Closed: round 7 recheck (3 of 3): how-it-works.md:377 now says the worker gets 'each contract it may call as declared (its name, kind, path, what it does, its inputs, outputs and effects), from which it writes its own reference'. Grepping test/ and docs/ (outside the ledger) finds no remaining 'how to refer to'. workerView (src/index.js ~8995) gives call: callable.map(declared).

### R6-records/chrono-3: trying-v8 says an unused prewarmed box stops after a fixed 4 minutes; its life now derives from the person's Verification time
- record, `docs/trying-v8.md:92`
- Owner (2026-10-17 00:25): it wasn't the question. I don't understand the need
- Required: Say that a prewarmed box no compile takes is stopped at the end of its life, which derives from the room's Verification time (three times it), or when the run ends. Name no fixed minutes.
- Closed: round 7 recheck (3 of 3): trying-v8.md:92 says an untaken prewarmed box 'is stopped at the end of its life, which is three times the room's Verification time, or when the run ends'. The code agrees: boxTimes in src/box.js:44 returns life: 3*t, and box-prewarm.js:62/84 uses that life. No fixed minutes are named.

### R6-records/chrono-4: The link readers are model agents but never appear in the graph, though the owner asked for every agent to be visible
- drift, `public/app.js:55`
- Owner (2026-10-16 18:36): the every agent should be visible in the tree...e.g. splitter manager worker etc
- Required: Show each link reader in the graph as an agent like the splitters and compilers, so every agent that runs in the room is visible in the tree.
- Closed: round 7 recheck (3 of 3): The room records each link reader (src/index.js:701-707, source_readers) and snapshots it as readers (index.js:1202). public/app.js:65-68 draws each reader as a 'reader' node (a square, SQUARE set at :35) under the room's manager, and the legend in index.html lists 'link reader'.

### R6-records/code-4: Benchmark dashboard note says a grader that could not run makes an unscored error, and a test pins that text
- record, `public/app.js:664`
- Owner (2026-10-16 05:54): why does it not go back? it should go back until done, just like anything else?
- Required: Drop 'a grader ... that could not run' from the note and its test. Say that a grading that could not run is graded again until it observes, and that only a room that could not run, or a stop, is counted apart.
- Closed: round 7 recheck (3 of 3): public/app.js:678 SCORED_NOTE now ends 'a grading that could not run is graded again until it observes', and only 'a room that could not run, an observer's stop' are counted apart. test/bench-frontend.test.js:90 pins the new text. 'a grader that could not run' as an unscored error is gone.

### R6-records/code-5: Agent traffic keeps only the last 300 events, so older traffic cannot be scrolled to
- extra, `public/app.js:434`
- Owner (2026-10-13 03:16): change agent traffic so most recent events are at the top and you scroll to see the last events
- Required: Give the traffic panel the room's whole event history, newest at the top, so the person can scroll down through every event, with no runtime row cap.
- Closed: round 7 recheck (3 of 3): In a v8 room the snapshot query has no LIMIT (src/index.js:1164, 1168), and neither does the delta (1300). events_truncated is set only for v7 (1306). mergeDelta (public/app.js:445-450) keeps every event and file for v8. The traffic list renders the whole list newest first (app.js:417-420). The 300/240 window stays for v7 only.

### R6-records/record-4: The answer a worker gets to an ask tells it 'Use it rather than writing your own'
- drift, `src/prompts.js:192`
- Owner (2026-10-15 15:57): in general I never want to tell an agent what they can't do. I want it to just simply be archiecturally the only path for them
- Required: The answer gives the contract as it exists in the worker's world (its line) and adds no instruction about what the worker must not write. Update the tests that pin the old sentence.
- Closed: round 7 recheck (5 of 5): MESSAGES.provided (src/prompts.js:193) is now `${contract}.`, the contract line alone, sent by answerAsk (src/index.js:8889). A grep for 'rather than writing your own' / 'Use it rather' across src, test, docs, README and CHANGELOG-v8.md finds it only in the ledger files.

### R7-room/record-1: A person's follow-up change reaches a worker as a '[complaint]' carrying the room's goal text verbatim, outside its prompt, and a test pins it
- drift, `src/index.js:8980`
- Owner (2026-10-16 05:44): the workers shouldn't know about their siblings. or about the overall project goal. it should be literally getting handed (here is your prompt, okay have fun now) after something decided it shouldnt' split
- Required: Don't hand the room's goal change to a worker as a complaint. A worker gets only its prompt, its files and the complaints about what its files did, so a change that concerns a worker must reach it as part of the prompt it is handed, not as goal text labelled as an observation.
- Closed: round 8 recheck (4 of 4): src/index.js:8968-8985: routeChange hands a change routed to a worker to revise(c.id,text), which appends it to revisions:<id> on the worker's row, and logs 'The change is part of its assignment: its prompt says it.' No '[complaint]' message carries it. The only '[complaint]' insert left is deliverComplaint (8832), and that is for compiler observations. assignmentOf (8335-8337) joins the entry's p

### R7-room/record-2: An answered ask makes the runtime rewrite level-file entries: the asker's and every intermediate manager's assignment gain the answered name as a call
- drift, `src/index.js:8886`
- Owner (2026-10-16 05:39): Managers rewrite their children's assignments at runtime. - this is why managers are clef. Clef is built to walk the tree and route questions. The builder can know what the original design is from the splitter, sure, but the manager doesn't need to know that, that's why we use an artifact for that.
- Required: A manager answers the ask (the asker hears the contract) and routes. It does not rewrite its children's assignments in the splitter's design artifact, so the level file keeps the original design the splitter wrote.
- Closed: round 8 recheck (4 of 4): src/index.js:8885-8890: answerAsk now only calls answerAsker with {call:c.name}, which goes into fn_answers. amendEntry is gone (grep finds no match). updateLevel is not called from the ask path, and neither is a write to a row's uses. assignmentOf (8336-8337) works out the callable names from the entry's calls plus the answered calls, and callableOf (8380) reads them, so the level file keeps what

### R7-splitter/code-1: Admitting a level gives every piece all its parent's packages for a guessed language, whatever packages the splitter named for it
- extra, `src/packages.js:83`
- Owner (2026-10-15 22:11; 2026-10-16 20:38): packages should be listed in the durable object upon creation, same way as interfaces. That way it can have the same hierarchy as interfaces || e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it
- Required: Give a piece the packages the splitter named for it through piece(), nothing more, the same way it gets only the contracts named for it. Drop the language-guess inheritance.
- Closed: 3a380a4 (with 296ba0b): a rebuild's pieces get only the packages, uses and refs the splitter named for them; the job no longer carries packages. Closed by round 9 quorum.

### R7-splitter/record-1: A validation a job writes for a contract the level already has never joins that contract's serves, so its examples reach no worker though the level's compiler checks it
- drift, `src/index.js:8510`
- Owner (2026-10-16 05:49 / 05:50): the worker doesn't get validations. The example sohuld be built from the validation. || there must 3 different examples for each contract
- Required: Every contract that a validation serves must carry that validation's id, including contracts the level already had, so the worker who delivers the contract gets its examples, rendered from the validation.
- Closed: round 8 recheck (3 of 3): admitLevel builds joins: every name a newly written validation serves that is not among this admission's contracts maps to those validation ids (src/index.js:8524). updateLevel applies joined() to the existing contracts of the manager's own level file (8528). finishLevel then runs serveBelow (8552, 8561-8570), which adds the ids to every live row's interfaces and to every child level file that lis

### R7-worker/record-1: The builder's compare-and-store gives up after an invented six joins, then re-runs the whole builder session on the room's budget
- extra, `src/index.js:131`
- Owner (2026-10-17 00:25): it wasn't the question. I don't understand the need (answering Claude's 'The 100-call cap was my own invention. I'd drop it and count each call against the room's turn budget'); also 2026-10-15 23:16: "no? there should be no stopgaps? ever?"
- Required: Drop the runtime-picked count. Keep joining and comparing until the children's work reads the same, and store the builder's finished work. No invented number should decide that a model turn is spent again.
- Closed: round 8 recheck (3 of 3): assemblePiece (src/index.js:3967-3978) loops `for(let tries=0;;tries++)` with no bound: it re-joins until pieceInput and ownedDigest read the same, then stores the piece. tries only labels the span. A grep for ASSEMBLE_TRIES finds nothing in src/. 'piece_moving' (index.js:3929) is now only an event in pieceBuilderTurn: when the children's work changed during the session, the builder is requeued wi

### R7-compiler/code-2: Native call adapter decides by an ASCII name regex that a defined function does not exist
- extra, `container/adapters/call-native.mjs:294`
- Owner (2026-10-16 20:38): e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it
- Required: Call the function by the name the contract declares, as its language reads it, with no runtime name pattern deciding that it is missing. Only the compiler's own answer says whether the file defines it.
- Closed: round 8 recheck (3 of 3): container/adapters/call-native.mjs at HEAD 2914aac has no name pattern deciding existence any more. Go, Rust and C++ ask the compiler through reachable() (lines 71-86): the call driver is built, and a reach probe for each name that fails it (go: `var x any = name`, line 300; rustc: __arity_of, line 328; g++: `using ::name`, line 373). C searches gcc's own -aux-info prototypes, with the name escape

### R7-edges/chrono-1: A linked page's title is still cut to 200 characters, and its URL to 500, before any splitter or worker sees it: the R6-worker/chrono-3 fix only removed the broker's copy of the clip
- unfixed, `src/fetcher.js:620`
- Owner (2026-10-16 19:41; 2026-10-17 00:25): how is this possible - this is the place where i WANT worker context? || it wasn't the question. I don't understand the need
- Required: Store and quote a linked page's title and URL as they are, with no character clip chosen by the runtime, in fetchSource, loadSources, quoteSource and sourceSummaries, so the worker and the splitter get them whole.
- Closed: round 8 recheck (3 of 3): No title or URL clip is left on any path from a linked page to a splitter or worker. htmlToText returns the <title> whole (fetcher.js:509, :529). titleOf takes the first markdown heading whole (fetcher.js:550-553). fetchSource sets result.title from sanitizeText(title) with no slice (fetcher.js:594). quoteSource passes url and title through sanitizeText only (fetcher.js:627-631). sourceSummaries s

### R7-edges/chrono-2: The benchmark loader refuses dataset links the owner's allowlist covers: it narrows FETCH_ALLOW to two hard-coded hosts
- extra, `src/bench.js:35`
- Owner (2026-10-15 05:16): 2. I want to be able to point this thing at links and benchmarks, like AI benchmarks
- Required: Fetch a benchmark from any link the owner's own allowlist covers, as the goal's links are fetched, with no runtime-picked subset of hosts.
- Closed: round 8 recheck (3 of 3): BENCH_HOSTS is gone. benchPolicy (bench.js:229-231) passes the owner's allow through fetchPolicy as it is, and benchRoute hands it env.FETCH_ALLOW (bench-run.js:381). guardedFetch then checks hosts against that list alone. Two comments still describe the old narrowing ('the owner's allowlist narrowed to the dataset hosts', bench.js:7-8 and bench-run.js:29-30). They are reported separately as a rec

### R7-edges/chrono-3: Bench cuts each task id to 80 characters, then silently skips any later row whose cut id matches an earlier one
- extra, `src/bench.js:135`
- Owner (2026-10-15 05:16; 2026-10-17 00:25): 2. I want to be able to point this thing at links and benchmarks, like AI benchmarks || it wasn't the question. I don't understand the need
- Required: Use each row's id as written, with no runtime length cap, so a benchmark's tasks are every row it holds, and list every skipped row.
- Closed: round 8 recheck (3 of 3): taskId (bench.js:130-131) uses the row's task_id, name or id as written, with no length clip. loadTasks (bench.js:198-212) lists every skipped row with its reason, and that includes a later row whose id exactly equals an earlier one ('a task with this id came earlier', :205). begin stores dataset.skipped whole (bench-run.js:99). False duplicates created by the clip can no longer happen. Rows that 

### R7-records/chrono-1: how-it-works and INSTALL still say a call step whose parameter type cannot be built from JSON is infrastructure (rerun, never a complaint), the behaviour 039cc00 removed
- record, `docs/how-it-works.md:411`
- Owner (2026-10-15 05:16): 1. more code that just js. Any code type. should be adrogenous
- Required: Rewrite how-it-works.md:411 and INSTALL-CLOUDFLARE.md:335 to say what the box does: a step the call adapter cannot build from JSON is what the check observed, a failed step that goes back as a complaint. Remove it from the list of checks that could not run.
- Closed: round 8 recheck (3 of 3): docs/how-it-works.md:411 now says what the call adapters build (the file's own structs, classes, enums and single-implementation interfaces) and that 'what JSON cannot give, such as a function or an interface several types implement, is the check's observed failure'. INSTALL-CLOUDFLARE.md:335 lists only box/Chromium start failures as checks that could not run, and no longer mentions JSON. A grep f

### R8-room/record-1: Level-file comments still describe the removed entry amendments and an 'ask job' that grows a level
- record, `src/index.js:8493`
- Owner (2026-10-16 05:39): Managers rewrite their children’s assignments at runtime. - this is why managers are clef. Clef is built to walk the tree and route questions. The builder can know what the original design is from the splitter, sure, but the manager doesn't need to know that, that's why we use an artifact for that.
- Required: Rewrite both comments to say what the code does now. The splitter's entries in the level file are never amended. An ask is answered, granted or passed up with ask_parent, and never becomes a level job. The only changes to the file are an admitted level or job, a validation joining serves, and an archive.
- Closed: 4ba0af0: the level-file comments name its three writers (an admission, serveBelow, archive) and say an ask never writes the file. Closed by round 9 quorum.

### R8-splitter/chrono-1: A browser check's selector is refused unless it is a 'simple selector' that starts with a tag, though the page runs any CSS selector
- extra, `src/validations.js:239`
- Owner (2026-10-16 16:14; 2026-10-16 20:40): you added those yourself. (16:14, on the runtime's rules for what a split may contain) || every model should work that way, where the runtime should only be interfaces exposed to the models. not parsing the models output, but functions exposed to the models. (20:40, accepting an interface whose validation() rule is 'The check must run as written')
- Required: Store the selector as the splitter writes it and let the box run it. Refuse it only when the page's selector engine cannot read it, and give that engine's own reason, with no runtime-picked selector grammar in validations.js or the adapter.
- Closed: 3a380a4: a browser check's selector is stored and run as written (page.locator); SELECTOR and ELEMENT_SELECTOR are gone. Closed by round 9 quorum.

### R8-splitter/chrono-2: A command line the splitter writes is parsed by the runtime's own quoting grammar, which refuses a backslash outside quotes
- drift, `src/validations.js:40`
- Owner (2026-10-16 20:38; 2026-10-16 20:40): e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it || every model should work that way, where the runtime should only be interfaces exposed to the models. not parsing the models output, but functions exposed to the models. for every model. For every interacti …
- Required: Give the splitter an interface that takes the command as its argument list (program, then each argument), stored and run exactly as given, instead of a flat command line that the runtime parses with a quoting grammar it picked.
- Closed: 3a380a4: a command is its argument list, stored as argv and run by the box's exec as given; the runtime's quoting grammar (commandArgv) is gone. Closed by round 9 quorum.

### R8-worker/chrono-1: A worker's available packages are filtered by the runtime's guess of the tree's languages from contract file extensions
- extra, `src/index.js:758`
- Owner (2026-10-15 22:11; 2026-10-16 20:38; 2026-10-16 20:08): packages should be listed in the durable object upon creation, same way as interfaces. That way it can have the same hierarchy as interfaces || e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it || the runtime should only be exposing functions that make other …
- Required: Show the worker every package its row lists, as the row holds it, just as its contracts are shown, with no runtime filter by guessed language.
- Closed: 3a380a4: packageView returns every package the row lists (no contractLanguages filter). Closed by round 9 quorum.

### R8-worker/record-1: rulings.md says a worker's file outside its contract paths 'reaches no one else', but the join ships every file of the worker's repository
- record, `docs/owner/rulings.md:94`
- Owner (2026-10-16 05:39): there should be no per command blocklists, there should be no path rules for agents, it's literally performed via architecture. They have commands they can run, things they can see, we don't block things here, okay? It's just they have their world that exists.
- Required: Rewrite rulings.md:94 to say what the owner ruled and the code does: a worker's world is its own repository, and every file it writes there is part of what the builder joins and ships. No sentence should say that a file outside the contract paths reaches no one.
- Closed: 4ba0af0: rulings.md and how-it-works say every file a worker writes is joined and ships: at a contract path, or under its own folder. Closed by round 9 quorum.

### R8-edges/chrono-2: Link reader agents are named reader-S1-2, not <role>-hex16 like every other agent
- drift, `src/index.js:703`
- Owner (2026-10-16 05:08): can everything here just get a base16 name? things should still be named manager or whatever, but just name it manager actually root is deprecated by design anyway, it should be manager-hex16 give boxes a hex16 name as well
- Required: Name each link reader reader-<hex16>, as every other agent is named <role>-<hex16>, and update the test that pins reader-S1-1.
- Closed: e6f22fd: each link reader is named reader-<hex16> (rowId), like every other row. Closed by round 9 quorum.

### R8-edges/chrono-4: Bench comments still say datasets are fetched under the owner's allowlist 'narrowed to the dataset hosts'
- record, `src/bench.js:7`
- Owner (2026-10-15 05:16): 2. I want to be able to point this thing at links and benchmarks, like AI benchmarks
- Required: Rewrite both comments to say what the code does: a dataset is fetched from any host the owner's FETCH_ALLOW allows, with the deployment's own hosts refused.
- Closed: 885f91e: bench comments say a dataset is fetched from any host FETCH_ALLOW allows. Closed by round 9 quorum.

### R8-records/chrono-1: README and INSTALL say the v8 box runs any code type 'with no fixed set of languages', but the box pins a fixed list and refuses everything else
- record, `README.md:96`
- Owner (2026-10-15 05:16 / 05:17): 1. more code that just js. Any code type. should be adrogenous || there shouldn't be any version pinning or code type pinning or specific prompt pinning.
- Required: Until the box actually runs any code type, the README and INSTALL must say what it does: a fixed set of languages from the box image, with function contracts in other languages refused at declaration. The open pinning items should not be described as settled.
- Closed: 4ba0af0: README and INSTALL say the box runs a fixed set of languages, its image's, and that any code type waits on the owner. Closed by round 9 quorum.

### R8-records/chrono-3: Dashboard says the manager states its level's contracts and validations; the owner gave that to the splitter
- record, `public/index.html:133`
- Owner (2026-10-16 05:21): manager (router of the system) - owns the interfaces of its children ... splitter - handles splitting the code into smaller chunks (essentially what you're calling manager now). Also build validations for that level in form of "contracts"
- Required: Say that the manager's splitter states the level (its contracts and the validations that check them), and that the manager owns its children's interfaces and routes.
- Closed: 4ba0af0: the dashboard says the manager's splitter states its level's contracts and validations. Closed by round 9 quorum.

### R8-records/code-2: The changelog says a v8 run is ready once its ready path answers at all, but without a network namespace the box still requires a status below 500
- record, `CHANGELOG-v8.md:466`
- Owner (2026-10-16 20:38): e.g. instead of the splitter writting a flat answer, and the runtime fixing it via matching or whatever, The splitter should be given interfaces and then write via those interfaces. That's it
- Required: Correct CHANGELOG-v8.md:466 to say what the box does: in a box without a network namespace a run counts as ready only once its ready path answers below 500. Keep it that way until the code counts any answer as ready, as the owner's 'write via those interfaces. That's it' requires.
- Closed: 4ba0af0: the changelog says a run is ready on any answer inside a network namespace, and below 500 without one (waiting on the owner). Closed by round 9 quorum.

### R8-records/record-1: Changelog and rulings say a level file stays as its splitter wrote it, but admissions rewrite level files below and replace contracts in the manager's own design artifact
- record, `CHANGELOG-v8.md:475`
- Owner (2026-10-16 05:39): Managers rewrite their children's assignments at runtime. - this is why managers are clef. Clef is built to walk the tree and route questions. The builder can know what the original design is from the splitter, sure, but the manager doesn't need to know that, that's why we use an artifact for that.
- Required: The owner's words make each level's artifact the original design its splitter wrote. Either keep each level file, the parent's and the ones below, as its own splitter wrote it, and record later joins and rebuilt contracts somewhere other than the original design, or change CHANGELOG-v8.md:475 and rulings.md:76 so they no longer claim the artifact stays as written while the runtime rewrites it.
- Closed: 4ba0af0: the changelog, rulings and how-it-works say what changes a level file (an admission, a serves join, an archive) and that a change or an answer never writes it. Closed by round 9 quorum.

## Rejected by quorum

- R1-record-14: CHANGELOG-v8.md never records the owner's 2026-10-16 rulings, so its last word is that workers get the goal and shared principles (`CHANGELOG-v8.md`). chrono: CHANGELOG-v8.md:59, :61 and :67 describe what the S6 and B1 slices did at the time, and that history is accurate. The code already honours the owner: there is no PRINCIPLES, no goal in workerView and no tamper scan. A missing changelog entry does not say something the owner didn't, and no ow
- R2-worker/chrono-3: The builder's link model is given every function contract in the whole tree, not its children's interfaces (`src/index.js`). worker/chrono: relinkBundle builds the linker's interfaces from this.allNodes().flatMap(promisedOf) filtered to functions (index.js:4148-4154). Every builder calls it through assemblePiece (3863), and compileLevel calls it too (9521). So a level's link model sees contracts from branches it doesn't j
- R3-worker/chrono-4: The join moves a worker's files that are not at a contract path into a runtime-named folder (components/p_<label>_<hex>/) (`src/index.js`). worker/chrono: Read in context, 'Don't fucking move data' (2026-10-16 05:39/05:41) answers 'The scope walk goes' and is about re-placing pieces and data into other branches (rulings.md:72 records it the same way). It does not cover where the join lays out a worker's unplaced files in the bundle, and
- R3-records/chrono-9: rulings.md and how-it-works record escalations and stuck reports as holds for the person, which the owner never asked for (`docs/owner/rulings.md`). records/chrono: Verified: rulings.md:61 still says 'Stuck reports, escalations and failures nothing below could settle are the room's to hold for the person', and how-it-works.md:355/419 say the same. No owner prompt rules this. The owner's 05:30 completion rule ('That's it'), 19:53 ('the runtime ke
- R4-records/chrono-5: Dashboard count sliders stop at fixed ceilings, though the owner asked for logarithmic to infinity (`public/index.html`). records/chrono: The ceilings exist: index.html:53-59 and ROOM_LIMITS at index.js:281. But after the 21:07 'logarithmic to infinty' prompt, the owner wrote on 2026-10-15 00:58: 'add a little red flash to the gui when you hit a limit on the slider and on the top menu'. That accepts that the sliders ha
- R5-records/code-3: how-it-works says Clef reviews each validation, a per-validation review the owner's split ruling removed (`docs/how-it-works.md`). records/chrono: The sentence 'beyond Clef's review of each' is ambiguous: 'each' can mean each level. Clef's split review covers the assignment, its contracts and the pieces, and the owner calls validations contracts (05:21). So the sentence is not clearly false, and it does not clearly bring back t
- R6-room/chrono-1: A complaint about the builder's glue can only be routed to a worker: the builder is never a route_to option and never hears what the compiler observed (`src/index.js`). room/chrono: The code matches the description. joinPiece deletes the origin of glue files (index.js:3822), the builder is never offered as route_to, and builderView carries no complaint. But the fix does not follow from the owner's words. At 2026-10-16 05:39 the owner said 'literally, only workers w
- R6-room/record-1: An ask is archived when no contract or package is offered for it, not when it is out of scope everywhere up to the room (`src/index.js`). room/chrono: The ledger has repeatedly closed findings by accepting this model: an ask is answered with a contract the children deliver or passed up with ask_parent, and one held nowhere up to the room archives the asker (R2-room/chrono-1, R4-room/record-2, R3-compiler/code-1 closure). The owner als
- R6-compiler/record-2: Box concurrency throttled to 4 per room by default, with a hard ceiling of 64 that silently falls back to 4 (`src/index.js`). compiler/chrono: index.js:4023 boxCap uses 4 unless BOX_CONCURRENCY is an integer from 1 to 64, so any other value silently becomes 4. boxSlot makes every compile wait for a slot. No prompt asks for a per-room box cap or sets its value, and the owner has asked for speed (05:16) and rejected invented
- R7-splitter/chrono-1: A call check may only call functions of one file, so no call check can validate functions that two pieces deliver together (`src/validations.js`). splitter/chrono: The code is cited correctly: validations.js:165-167 refuses a call check whose functions are in different files. But no owner words require a call check to span files. The interface the owner accepted at 2026-10-16 20:40 says a call returns 'exactly why' it can't store something and
- R8-splitter/code-3: Routes and http steps are limited to five HTTP methods by a runtime list (`src/validations.js`). splitter/chrono: Verified. METHODS (validations.js:33), the refusal in httpStep (:188), ROUTE_NAME (contracts.js:28, used in nameError and called from splitter.js:84) and the http_check enum in prompts.js all limit methods to GET, POST, PUT, PATCH and DELETE. The box's http-check.mjs:85,95 sends any
- R8-edges/record-3: Benchmark 'Rooms at once' is hard-capped at 16, a ceiling no person can raise (`src/bench.js`). edges/chrono: The cap exists (bench.js:30 concurrency [1,16], enforced in benchRoute). But the owner accepted bounded inputs with limits ('add a little red flash to the gui when you hit a limit on the slider', 2026-10-15 00:58). The quorum rejected the analogous box-concurrency ceiling (R6-compiler/
- R8-records/chrono-2: A manager is no longer drawn split in half (|) while its builder is building; it stays a full circle (`public/app.js`). records/chrono: The 2026-10-13 00:14 split-manager glyph was asked for when the builder was not its own node, as the way to show that a manager was using a builder. Later prompts change that picture: at 00:22 'literally just circles', and on 2026-10-16 18:36/18:37 every agent visible in the tree, wi
- R9-compiler/chrono-2: The check box holds only UTF-8 text: a project's binary base files (images, fonts, archives) are left out of the world its checks run in (`src/index.js`). compiler/chrono: addCarried (index.js:3741-3753) does leave non-UTF-8 base files out of the box. But the quoted 05:39 prompt is about per-command blocklists and path rules for agents, and the owner never spoke about how the box stores binary files. Leaving binary files out is a limit of how the box 

## Rounds

- Round 1 (2026-10-17, one team of three): 47 findings, 23 confirmed, 23 folded into confirmed duplicates, 1 rejected.
- Round 2 (2026-10-17, six teams of three, snapshot a7d3ea0): 71 findings, 37 confirmed, 33 folded, 1 rejected; rechecks closed 4 of 6 (R1-chrono-1, -2, -8, R1-record-12), the R1-chrono-6 dispute was rejected, and R1-record-11 was only partly fixed.
- Round 3 (2026-10-17, six teams of three, snapshot 14bd160): 84 findings, 38 confirmed, 44 folded, 2 rejected; rechecks closed 38 of 53 and reopened 15.
- Round 4 (2026-10-17, six teams of three, snapshot 9658fd3): 63 findings, 36 confirmed, 26 folded, 1 rejected; rechecks closed 37 of 51 and reopened 14.
- Round 5 (2026-10-17, six teams of three, snapshot 1c10f2f): 52 findings, 31 confirmed, 20 folded, 1 rejected; rechecks closed 32 of 43 and reopened 11.
- Round 6 (2026-10-17, six teams of three, snapshot ebc1dac): 46 findings, 26 confirmed, 17 folded, 3 rejected; rechecks closed 33 of 41 and reopened 8.
- Round 7 (2026-10-17, six teams of three, snapshot 1554ac3): 28 findings, 14 confirmed, 13 folded, 1 rejected; rechecks closed 25 of 31 and reopened 6.
- Round 8 (2026-10-17, six teams of three, snapshot 2914aac): 29 findings, 17 confirmed, 9 folded, 3 rejected; rechecks closed 10 of 11 and reopened 1.
- Round 9 (2026-10-17, six teams of three, snapshot 9bcfb34): 23 findings, 18 confirmed, 4 folded, 1 rejected; rechecks closed 12 of 12 and reopened 0.
