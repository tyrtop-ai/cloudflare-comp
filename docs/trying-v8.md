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

If you serve the Worker on your own domain, set `SELF_HOSTS` first ([INSTALL-CLOUDFLARE.md](../INSTALL-CLOUDFLARE.md#optional-which-sites-a-goals-links-may-be-read-from-v8-pipeline)).

## 2. Set the room to v8

Use a new room for each goal. Set **Pipeline** to **v8** before pressing **Start**. A room keeps the pipeline it started with, and Continue can't change it. Leave the other settings at their defaults, with a turn budget of 100.

The room creates one manager from your prompt, and the manager's splitter states its level through functions. The **Levels** panel then shows each validation (with a pass, fail or untested chip), each manager's level file (a button that opens it), and each splitter step with Clef's verdict on it. The graph shows every agent: managers and workers as circles, splitters, builders and compilers as squares. If the room holds, the panel says why:

| Hold | Meaning | What to do |
|---|---|---|
| `base_confirm` | A contract would change a file of the repo the room started from, and only you can grant that | Select the files to grant and press Continue, or send a follow-up prompt that leaves the file out |
| `checks_blocked` | The validations couldn't run (the box, Chromium, Clef) | Retries itself after 30 s, 2 min and 10 min, then waits for Continue |
| `checks_untested` | Everything that runs passed, but some files would ship without a compile or a box | Continue accepts the project as it is (logged as `unchecked_accepted`), or send a follow-up prompt |
| `split_capacity` | A manager couldn't create its children within the room's agent or depth limit | Raise the limit and press Continue |
| `clef_blocked` | Clef couldn't answer a manager's choice or a review | Continue asks again |
| any other | Something nothing below could settle reached the room; its text says what | Read the text. Continue wakes the row it names, or send a follow-up prompt |

## 3. Try these goals

**"Add a README explaining how to run it."** Set **Start from** to a public GitHub repo, a small one of yours.
- The **Sources and base** panel should show how many files were read and what was skipped.
- The level should have `README.md` as a doc contract with a judge validation (Clef reads the file and answers its question yes or no).
- If the repo already has a README, the room holds at `base_confirm`: only you grant changing an existing file.
- **Download app (.zip)** should be the repo plus the new README. `.recursive/RUN.md` lists what wasn't carried over.

**"A Python CLI that converts temperatures."**
- The level should have a command contract and command validations, with three different examples for the command.
- If a validation fails, open the worker's complaint in the traffic panel. It is what the compiler observed, as it observed it.
- In the export, check `state.toolchain_inventory`: it shows the Python and Node versions, and whether checks ran with the network off (`network`).
- The same inventory shows the box's host name (`hostname`, which should be `box-` and 16 hex characters) and `getfqdn`, which should be `{"ok": true, "value": "box-…"}` with the same name (section 6.2).

**"A static web page with a to-do list."**
- The level should have a page contract (`index.html`) served as it is, and browser validations.
- The browser validations are the most likely to hit infrastructure problems (Chromium starting on `standard-1`). A `checks_blocked` hold, or a validation marked `infrastructure`, means the box side failed, not the page.

**"Build a small issue tracker that lets someone create, view, update, and delete tickets."** (the old default)
- No `start()` requirement is added in v8. The splitter chooses the shape, and the contracts it declares (routes, a page, a command) say what it chose.
- Watch the graph: each piece is a manager of its own, with its own splitter steps, builder and compiler.
- If you have time, run the same goal in a v7 room to compare wall time, repair rounds and whether you'd use the result.

## 4. A small benchmark

In the **Benchmarks** panel:
- **Dataset URL:** the HumanEval rows URL shown in the field's placeholder (datasets-server.huggingface.co).
- **Tasks:** 10. **Rooms at once:** 2. **Keep task rooms:** the default (keeps the ones that didn't pass).
- **Grading:** the default, **Until done**: a failed grade goes back into the room as a complaint, and the room works on it until the task passes or its budget is spent. **Once** grades only what each room ships the first time it completes (pass@1 with no test feedback).
- Use the same model pickers and turn budget as for the rooms above.

Press **Run benchmark**. It keeps going with the page closed. A task room is an ordinary room whose prompt is the task's prompt: for most HumanEval tasks Clef's pre-grade should keep the level whole, so one worker writes the function. pass@1 counts only scored tasks. Errors (a box that couldn't run, a stop, a hold) are counted separately, so a high error count points at the platform, not the model.

## 5. What to send back

- **For each room:** **Export observation JSON**. It contains each manager's level file, the validations and their results, the splitter steps, the complaints and asks, every event and every span. The spans are what the speed analysis reads: each model call (role, model, tokens), each Clef gate, each git phase, each box run (each check's ms), and dispatch delays. Every v8 compile opens its own fresh box (section 6), so its container span carries `box: {fresh: true, internet: false, start_ms, ready_ms, image, name}`; `start_ms` is that compile's start cost. A run's first compile normally runs in a box opened earlier (section 6.3): its span adds `prewarmed: true`, `waited_ms` and `prewarm_ms`, and a `box` span named `prewarm` records that box's own start.
- **For the benchmark:** the JSON from `GET /api/bench?id=<run id>` (task outcomes, times, tokens, room ids), plus the room exports of one or two failed tasks.

**The room export contains your Cloudflare account id**, inside the Artifacts remote URLs. Don't commit it to this repo or post it anywhere public; send it privately. The benchmark status JSON contains no remote URLs or account ids.

## 6. Capability boxes: every v8 compile in its own box

A v8 room runs each compile in a **fresh, single-use box**: a new Durable Object (`Box`) with its own VM, started with the internet off, which runs the build runner on the compile's request and is destroyed afterwards. A worker's `run_examples` and a benchmark's grading each open one too, and no two benchmark tasks share one. The runner's own isolation still runs inside the box. If a box can't be opened (for example, if the platform refuses `enableInternet: false`, or the image isn't deployed), the compile holds at `checks_blocked` with its usual automatic retries; there is no shared Container to fall back to. v7 rooms keep `BuildExecutor` unchanged.

The boxes come from a second Container application in `wrangler.jsonc`. It uses the `durable_object` scheduling policy (public beta) and has three images: `check` (Node, Python), `browser` (`check` plus Chromium) and `fetch` (Node only). The first `npm run deploy` builds all three, so it takes longer.

The first box of a run is slow to start: its image is pulled, so it takes 9 to 15 s to become ready instead of about 1 s. The span records it with `cold: true` (any box whose `ready_ms` is over 5 s). Later compiles start warm. The room opens that first box early, as soon as its first level is admitted (section 6.3), so the first compile normally finds it ready.

### 6.2 The box's host name

The platform names each box's VM with a label longer than the 63 characters a host name label may have. On such a name Python's `socket.getfqdn` fails (`UnicodeError: encoding with 'idna' codec failed (UnicodeError: label too long)`), and so does `http.server`'s `HTTPServer`, which calls it when it binds, so every Python server would crash.

The box image runs the build runner under `/opt/box/hostname.py`. It gives the runner, and everything it starts, the box's own name in a user namespace of its own: `box-` followed by the first 16 hex characters of the SHA-256 of the box's Durable Object id (for example `box-3f9a0c27d18e4b65`), with an `/etc/hosts` that resolves it, so `getfqdn` answers without asking DNS. It needs no root: it uses the same user namespaces the runner already uses to turn the checks' network off. The same name is in the compile's span (`box.name`), in the inventory and in the probe's report.

If the box can't set its name, the runner still runs and its inventory says so: `hostname_ok: false`, `hostname_status` with the reason (for example `unshare: EPERM`) and `getfqdn` with the error. Every check that then fails in that box is the box's problem, not the code's: the room holds at `checks_blocked` with a `compile_infrastructure` text that starts with "The box's environment, not the code", logs a `box_environment` event, and sends no worker a complaint. The same rule covers the other environment facts the inventory reports, for example a check that couldn't start `python3` in a box that reports no Python.

After deploying, run the probe's `hostname` item once (section 6.1) and check that `runner_named` is `true`.

### 6.3 The prewarmed box

The room opens the box its first compile will use as soon as it knows which image the first level's validations need: when the first level is admitted, so the box starts while the first workers write.

The prewarmed box is like any other box: a new Durable Object, internet off, `standard-1`, the `check` image (or `browser` when the level has browser validations), and it runs one compile. Only the first compile that needs exactly that image takes it. If a compile needs the other image (a level added validations, or a piece's compile runs only some of them), the prewarmed box is stopped unused and the compile opens its own. The box counts against `BOX_CONCURRENCY` from the moment it opens, and the room opens none when no slot is free. A prewarmed box that no compile takes within 4 minutes, or that is still open when the run ends, stops, and a `box` span named `prewarm_unused` records why.

In the export, compare the `prewarm` span with the first compile's container span. The prewarm should end before or soon after the compile starts, and the compile's `box.waited_ms` should be well under its `prewarm_ms`.

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
| `network` | with the internet off: TCP 1.1.1.1:53 and :443, DNS, HTTP 80/443, ICMP; plus a control box with the internet on | that `enableInternet: false` really holds |
| `caps`, `unshare` | `CapEff` of an exec (default user, uid 10001, uid 0), and which namespaces `unshare` may create | which in-runner measures still work inside a box |
| `env` | environment variable names of an exec and of PID 1 | that nothing secret reaches a box |
| `hostname` | the platform's host name (scrubbed like any id, with each label's length) and Python's `getfqdn` of it; the name the runner runs under through `/opt/box/hostname.py` (`runner_named`: it is the box's name, and `getfqdn` answers it); whether uid 0 could set the platform's name itself | that the runner's checks run under a valid host name (section 6.2) |
| `snapshot` | `snapshotContainer` time and size, and the restore start | the install box hand-over (S9) |
| `browser` | Chromium loading `http://app.internal/` through interception, and a WebSocket back | the server box and client box split (S2) |
| `relay` | a line relayed box A → Durable Object → box B | the bench split's call protocol (S4) |
| `fanout` | 30 boxes from one Durable Object at once | per-check fan-out |
| `private` | 169.254.169.254, RFC 1918, 100.64/10 and IPv6 ULA/link-local with the internet on | whether the fetch box (S6) needs deny interception |
