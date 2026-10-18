# Trying v8

A checklist for a live v8 run, and what to look for in each one. [how-it-works.md](how-it-works.md#v8-experimental) describes how a v8 run goes.

## 1. Deploy

```bash
git pull && npm ci && npm test
docker info              # must succeed
npm run deploy           # or npm run deploy:tyrtop
npx wrangler containers list
```

The Container image is bigger now (Node LTS, Python 3, Chromium headless shell; about 0.9 GB unpacked), so the first deploy and the first Container start take a few minutes longer. Leave `npx wrangler tail qwen-control-plane-v4 --format pretty` running during the runs.

If you serve the Worker on your own domain, set `SELF_HOSTS` first ([INSTALL-CLOUDFLARE.md](../INSTALL-CLOUDFLARE.md#optional-which-sites-a-prompts-links-may-be-read-from-v8-pipeline)).

## 2. Set the room to v8

Use a new room for each goal. Set **Pipeline** to **v8** before pressing **Start**. A room keeps the pipeline it started with, and Continue can't change it. Leave the other settings at their defaults, with a turn budget of 100.

The room creates one manager from your prompt, and the manager's splitter states its level through functions. The **Levels** panel then shows each validation (with a pass, fail or untested chip), each manager's level file (a button that opens it), and each splitter session with Clef's verdict in it. The graph shows every agent: managers and workers as circles, link readers, splitters, builders and compilers as squares. The room is done when its manager's compiler observes every validation passing; nothing else completes it. If the room holds, the panel says why:

| Hold | Meaning | What to do |
|---|---|---|
| `split_capacity` | An extension added a worker to a room already at its agent limit, or the limit is below what the room holds (a division, hand-down or rebuild within the limits is always created) | Raise the limit and press Continue |
| any other | Something nothing below could settle reached the room; its text says what | Read the text. Continue wakes the row it names, or send a follow-up prompt |

## 3. Try these goals

**"Add a README explaining how to run it."** Set **Start from** to a public GitHub repo, a small one of yours.
- The **Sources and base** panel should show how many files were read and what was skipped.
- The level should have `README.md` as a doc contract with a judge validation (the compiler agent reads the file and gives its verdict on the question).
- If the repo already has a README, the worker whose contract names it rewrites it: the room changes its own copy, and the export is a new branch.
- **Download app (.zip)** should be the repo plus the new README. `.recursive/RUN.md` lists what wasn't carried over.

**"A Python CLI that converts temperatures."**
- The level should have a command contract and command validations, with three different examples for the command.
- If a validation fails, open the worker's complaint in the traffic panel. It is what the compiler observed, as it observed it.
- In the traffic panel, each `compiler_session` event says how many calls the compiler made, how many commands it ran in its box, how many results it gave and how it ended; each worker's `session` event says how many commands it ran in its own box. A compiler that ran no command judged the CLI without running it.
- No language list is involved: watch what the compiler and the workers install and run in their boxes.

**"A static web page with a to-do list."**
- The level should have a page contract (`index.html`) served as it is, and browser validations.
- A level with browser validations gets the `browser` image (with Chromium); the compiler agent drives the page however it judges (Playwright is installed globally in that image). A validation the compiler gave no result for has none: no worker gets a complaint for it, and the compiler runs again, each run a turn of the room's budget, with no hold. A failed result goes back to its worker with what the compiler observed.

**"Build a small issue tracker that lets someone create, view, update, and delete tickets."** (the old default)
- No `start()` requirement is added in v8. The splitter chooses the shape, and the contracts it declares (routes, a page, a command) say what it chose.
- Watch the graph: each piece is a manager of its own, with its own splitter (one square, its sessions in its details), builder and compiler.
- If you have time, run the same goal in a v7 room to compare wall time, repair rounds and whether you'd use the result.

## 4. A small benchmark

In the **Benchmarks** panel:
- **Dataset URL:** the HumanEval rows URL shown in the field's placeholder (datasets-server.huggingface.co).
- **Tasks:** 10. **Rooms at once:** 2. **Keep task rooms:** the default (keeps the ones that didn't pass).
- **Grading:** a failed grade goes back into the room as a complaint, like anything else, and the room works on it until the task passes or its budget is spent.
- Use the same model pickers and turn budget as for the rooms above.

Press **Run benchmark**. It keeps going with the page closed. A task room is an ordinary room whose prompt is the task's prompt: for most HumanEval tasks Clef's review should say NO to every division the splitter proposes, so the level goes whole to one worker, which writes the function. A task's outcome is what the room and the grader observed: graded (passed or failed), or a failure when the room failed, held or ran out of turns. A task that was stopped, or whose room stopped with an error, is counted apart from the scored ones. A grading that could not run is no grading: the room is graded again until one observes it. A grading that ran and gave no grade settles the task as an error. A Python or JavaScript task is graded by its harness's command; a task in any other language by a compiler agent's session, which runs the benchmark's tests in its box and whose result is the grade.

## 5. What to send back

- **For each room:** **Export observation JSON**. It contains each manager's level file, the validations and their results, the splitter sessions, the complaints and asks, every event and every span. The spans are what the speed analysis reads: each model call (role, model, tokens), each Clef gate, each git phase, each box session, and dispatch delays. Every compiler session, and every worker session that runs a command, has its own box (section 6), so its container span (named `compiler` or `worker`) carries `commands` and `box: {fresh: true, internet: true, image, instance, name, start_ms, ready_ms, cold}`; `start_ms` is that box's start cost. A run's first session normally runs in a box opened earlier (section 6.3): its span adds `prewarmed: true` and `waited_ms`, and a `box` span named `prewarm` records that box's own start.
- **For the benchmark:** the JSON from `GET /api/bench?id=<run id>` (task outcomes, times, tokens, room ids), plus the room exports of one or two failed tasks.

**The room export contains your Cloudflare account id**, inside the Artifacts remote URLs. Don't commit it to this repo or post it anywhere public; send it privately. The benchmark status JSON contains no remote URLs or account ids.

## 6. Capability boxes: every v8 session in its own box

A v8 room gives each compiler session, and each worker session that runs a command, a **single-use box**: a new Durable Object (`Box`) with its own VM, started with the internet on, opened on the session's first command, holding the session's files in `/work`, and destroyed when the session ends. Each command runs there as the box's root, under the box's own host name (section 6.2), with no environment but a fixed `PATH` (and `BOX_HOSTNAME_STATUS`), so the agent installs whatever it needs (`src/box-session.js`). A benchmark's grading opens one of its own, with the internet on too, and no two benchmark tasks share one. If a box can't be opened (for example, if the image isn't deployed), each `run` says so to the agent; a validation the compiler then gives no result for has none, and the compiler runs again within the room's turn budget. There is no shared Container to fall back to. v7 rooms keep `BuildExecutor` unchanged.

The boxes come from a second Container application in `wrangler.jsonc`. It uses the `durable_object` scheduling policy (public beta) and has three images: `check` (Node, Python 3, Go, gcc and g++, a Java JDK, Ruby, PHP, Rust and their package managers, so a session that needs one of these doesn't wait for its install), `browser` (`check` plus Chromium) and `fetch` (Node only). The first `npm run deploy` builds all three, so it takes longer.

The first box of a run is slow to start: its image is pulled, so it takes 9 to 15 s to become ready instead of about 1 s. The span records it with `cold: true` (any box whose `ready_ms` is over 5 s). Later boxes start warm. The room opens that first box early, as soon as its first level is admitted (section 6.3), so the first session normally finds it ready.

### 6.2 The box's host name

The platform names each box's VM with a label longer than the 63 characters a host name label may have. On such a name Python's `socket.getfqdn` fails (`UnicodeError: encoding with 'idna' codec failed (UnicodeError: label too long)`), and so does `http.server`'s `HTTPServer`, which calls it when it binds, so every Python server would crash.

The image holds `/opt/box/hostname.py`, and every command of an agent's session runs through it (`src/box-session.js`, `BOX_HOSTNAME`), as the box's root. The command gets host-name and mount namespaces of its own, whose host name is the box's own name: `box-` followed by the first 16 hex characters of the SHA-256 of the box's Durable Object id (for example `box-3f9a0c27d18e4b65`), with an `/etc/hosts` that resolves it, so `getfqdn` answers without asking DNS. The same name is in each session's span (`box.name`) and in the probe's report. When the namespaces can't be made, the command still runs, under the platform's name, and `BOX_HOSTNAME_STATUS` in its environment says which: `set`, or why not.

Whatever the compiler then observes in its box, it reports as it observed it. Whether a Python server binds in a live compiler's box has not been observed since the redesign.

After deploying, you can run the probe's `hostname` item once (section 6.1): `runner_named` says whether the wrapper names the box when it runs as a session's commands do: as the box's root, in its folder, without a user namespace.

### 6.3 The prewarmed box

The room opens the box its first session will use (a worker's first command, or a compiler's) as soon as it knows which image the first level's validations need: when the first level is admitted, so the box starts while the first workers write.

The prewarmed box is like any other session's box: a new Durable Object, internet on, `standard-1`, the `check` image (or `browser` when the level has browser validations), and one session runs in it. Only the first session that needs exactly that box takes it. If a session needs the other image (a worker whose validations have no browser check, a level that added validations, or a piece's compile that runs only some of them), the prewarmed box is stopped unused and the session opens its own. The box counts against `BOX_CONCURRENCY` from the moment it opens, and the room opens none when no slot is free. A prewarmed box that no session takes is stopped at the end of its life, which is three times the room's **Verification time**, or when the run ends if that comes first, and a `box` span named `prewarm_unused` records why.

In the export, compare the `prewarm` span with the container span of the first session that took it (`box.prewarmed: true`). The prewarm should end before or soon after that session starts, and its `box.waited_ms` should be well under the `prewarm` span's length.

### 6.1 The S0 probe: run it once after deploying

The probe measures what the box design depends on and the docs don't settle: start time, exec latency, what an internet-off box can reach, the process capabilities, user namespaces, snapshots, Chromium and WebSockets through interception, relaying between boxes, starting 30 boxes at once, and private ranges with the internet on. It is off by default and owner-only (`APP_TOKEN`).

```bash
npx wrangler deploy --var BOX_PROBE:1          # or set "BOX_PROBE": "1" in wrangler.jsonc and deploy
curl -sS -X POST "https://<your worker host>/api/dev/box-probe" \
  -H "authorization: Bearer $APP_TOKEN" -H 'content-type: application/json' \
  -d '{"samples": 5}' > box-probe.json
npx wrangler deploy                            # turn it off again (BOX_PROBE back to 0)
```

The full probe opens about 70 boxes and takes a few minutes; keep `curl` waiting. To run part of it, pass `"only"` with any of `start`, `exec`, `network`, `caps`, `unshare`, `env`, `hostname`, `snapshot`, `browser`, `relay`, `fanout` and `private`, for example `{"only": ["network", "browser"]}`. `samples` (1 to 10) is the number of boxes opened per image for the start timings. An item that fails reports its error and the probe goes on.

**What to send back:** `box-probe.json` as it is. It contains timings, true/false results, error codes and the *names* of environment variables (never their values). The probe removes image references, ids and anything else shaped like an account id before it answers, so the file holds no secret, account id or repository name. Glance over it before sending anyway. The questions it answers, and what each answer decides:

| Item | What it measures | Decides |
|---|---|---|
| `start` | start→ready p50/p95 per image and instance | whether a warm pool is needed (p95 above 1.5 s) |
| `exec` | exec round trip from a Durable Object, and inside the box | per-check box cost (S2) |
| `network` | with the internet off: TCP 1.1.1.1:53 and :443, DNS, HTTP 80/443, ICMP; plus a control box with the internet on | that `enableInternet: false` really holds, should a box need it (no v8 box has the internet off: a worker's, a compiler's and a grading's all have it on) |
| `caps`, `unshare` | `CapEff` of an exec (default user, uid 10001, uid 0), and which namespaces `unshare` may create | what an agent's commands (uid 0) may do inside a box |
| `env` | environment variable names of an exec and of PID 1 | that nothing secret reaches a box |
| `hostname` | the platform's host name (scrubbed like any id, with each label's length) and Python's `getfqdn` of it; the name a command run as root, as a session's are, runs under through `/opt/box/hostname.py` (`runner_named`: it is the box's name, and `getfqdn` answers it); whether uid 0 could set the platform's name itself | whether the wrapper every session's command runs through can name a box in this deployment (section 6.2; the probe runs it as root, as a session does) |
| `snapshot` | `snapshotContainer` time and size, and the restore start | the install box hand-over (S9) |
| `browser` | Chromium loading `http://app.internal/` through interception, and a WebSocket back | the server box and client box split (S2) |
| `relay` | a line relayed box A → Durable Object → box B | the bench split's call protocol (S4) |
| `fanout` | 30 boxes from one Durable Object at once | per-check fan-out |
| `private` | 169.254.169.254, RFC 1918, 100.64/10 and IPv6 ULA/link-local with the internet on | whether the fetch box (S6) needs deny interception |
