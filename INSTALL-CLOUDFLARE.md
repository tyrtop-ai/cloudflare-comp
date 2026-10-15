# Deploy to your own Cloudflare account

This guide deploys the control plane as a new Worker on your own Cloudflare account. Everything runs on Cloudflare: inference on Workers AI, state in Durable Objects, code in Artifacts, builds in Containers. You need no local model or GPU. For what the system does, see [README.md](README.md).

## Prerequisites

- **Node.js 22.13 or newer** and npm (`node --version`). Wrangler 4 needs Node 22, and the test suite uses Node's built-in `node:sqlite`.
- **Git.**
- **Docker running locally** (`docker info` must succeed). `wrangler deploy` builds the `BuildExecutor` image from `container/Dockerfile` and pushes it to your account, and it needs Docker even for `--dry-run`.
- **A Cloudflare account with Workers AI, Artifacts, Durable Objects and Containers.** Containers require the Workers Paid plan.

## 1. Get the code and run the local checks

```bash
git clone https://github.com/tyrtop-ai/cloudflare-comp.git
cd cloudflare-comp
npm ci
npm run check
npm test
```

`npm ci` installs the exact versions pinned in `package-lock.json`, including Wrangler. The checks use fakes and never contact Cloudflare, so passing them says nothing about your account. They confirm that the checkout and your Node version are good.

## 2. Log in to Cloudflare

```bash
npx wrangler login
npx wrangler whoami
```

If your login can reach several accounts, set `CLOUDFLARE_ACCOUNT_ID` in your shell to choose the account to deploy to.

## 3. Check the Artifacts namespace

Every agent's git repository is created in the Artifacts namespace named in `wrangler.jsonc`:

```jsonc
"artifacts": [{ "binding": "ARTIFACTS", "namespace": "default" }]
```

Cloudflare's [Artifacts documentation](https://developers.cloudflare.com/artifacts/concepts/namespaces/) says that creating a repository under a namespace that does not exist creates the namespace. A missing `default` should therefore appear when the first run creates Root's repository. Wrangler 4.149 can list and inspect namespaces but has no command to create one. This guide follows the documentation here; implicit creation has not been tested on a fresh account.

To confirm before a run that your account can create repositories in `default` (and to create the namespace if it is missing), create and delete a probe repository:

```bash
npx wrangler artifacts namespaces list
npx wrangler artifacts repos create artifacts-probe --namespace default
npx wrangler artifacts repos delete artifacts-probe --namespace default
npx wrangler artifacts namespaces get default
```

If `repos create` fails, every run would also fail when it creates Root's repository: check that Artifacts is enabled for the account you deploy to. To use another namespace, change `namespace` in `wrangler.jsonc` before you deploy, and use that name in the commands in this guide.

## 4. Deploy

```bash
docker info        # must succeed
npm run deploy     # runs wrangler deploy
```

This one command:

- uploads the Worker `qwen-control-plane-v4` (`src/index.js`) and the dashboard in `public/` as static assets;
- creates the three SQLite-backed Durable Object classes `ControlRoom`, `ManagerShard` and `BuildExecutor`;
- binds Workers AI (`AI`) and Artifacts (`ARTIFACTS`);
- builds the Container image from `container/Dockerfile` (the Node LTS channel, Python 3 with pytest, Playwright's Chromium headless shell, `build-runner.mjs` and its check adapters; about 0.9 GB unpacked, 0.35 GB compressed) and deploys it on `standard-1` instances, up to 4.

Wrangler prints the Worker URL, `https://qwen-control-plane-v4.<your-subdomain>.workers.dev`. Cloudflare provisions the Container separately, so it can take a few minutes after a successful deploy before it is ready:

```bash
npx wrangler containers list
```

Always deploy with `wrangler deploy` (`npm run deploy`). `wrangler versions upload` does not deploy Container changes.

**Container size and cost.** `wrangler.jsonc` runs the build Container as `instance_type: "standard-1"` (1/2 vCPU, 4 GiB, 8 GB disk) instead of the default `lite` (1/16 vCPU, 256 MiB, 2 GB). This makes each compile's checks several times faster. Memory and disk are billed on the provisioned size for as long as an instance runs, which comes to about $0.038 per running hour against about $0.0024 for `lite`. CPU is billed only on active use. The 25 GiB-hours a month included in the plan cover about 6 instance-hours of `standard-1`, against about 100 of `lite`. With all 4 instances running, the cost is about $0.15 an hour. An instance sleeps after 120 s idle, and a pre-warmed one that gets no compile within 60 s is stopped. To go back to the default, delete the `instance_type` line, or set `"basic"` (1/4 vCPU, 1 GiB) as a middle option, then run `npm run deploy`.

### Optional: your own domain

To serve the Worker on a hostname of a domain whose DNS is on Cloudflare in the same account, deploy with `--domain`. Wrangler creates the DNS record and certificate (remove any existing A or CNAME record for that hostname first):

```bash
npx wrangler deploy --domain ai.example.com
```

The `workers.dev` URL keeps working. The domain is passed on the command line, not set in `wrangler.jsonc`, so the default `npm run deploy` works on any account. The author's own deployment uses `npm run deploy:tyrtop`, which serves it at `ai.tyrtop.com`.

## 5. Set the access token

The API requires a bearer token stored as a Worker secret:

```bash
npx wrangler secret put APP_TOKEN
```

Paste a long random value, for example the output of `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`. Keep it out of Git. Until the secret is set, every `/api/*` request returns `503` with `Set APP_TOKEN with wrangler secret put APP_TOKEN`; the dashboard page itself still loads. `wrangler secret put` publishes a new Worker version, so no extra deploy is needed.

### Optional: a GitHub token for exports

To push a run's application to GitHub through `POST /api/export/github`, store a GitHub token as a second secret. The dashboard's **Push to GitHub** button is hidden for now, while the export is not being tested; the API route stays available (see [Using the API directly](#using-the-api-directly)).

```bash
npx wrangler secret put GITHUB_TOKEN
```

Use a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) limited to the repositories you export to, with **Contents: Read and write** and **Pull requests: Read and write** (GitHub adds **Metadata: Read** itself). The token stays in the Worker: the export reads it from the secret only, never from a request, never returns or logs it, and removes it from every error message. The Worker talks only to `https://github.com` and `https://api.github.com` for exports. Without the secret, `POST /api/export/github` returns `503` with `Set GITHUB_TOKEN with wrangler secret put GITHUB_TOKEN`; downloading the app as a ZIP needs no token.

### Optional: which sites a goal's links may be read from (v8 pipeline)

A v8 run reads the `https://` links written in its goal once, at the start, and a run can start from a public GitHub repo or a room's previous result (**Start from** in the dashboard, or `base` in `POST /api/run`). Links are read only from hosts on an allowlist of host suffixes. Without a setting, the list is the suggested default in `src/fetcher.js` (`DEFAULT_ALLOW`); to set your own, add a comma-separated `FETCH_ALLOW` var, for example `"FETCH_ALLOW": "github.com,raw.githubusercontent.com,docs.python.org"` under `vars` in `wrangler.jsonc`. The Worker's own host is never read, whatever the list says. A repo is read from `api.github.com` and `codeload.github.com` without a token (`GITHUB_TOKEN` is never used to read), up to 400 text files and 2 MB. A link that cannot be read is listed in the dashboard's **Sources and base** panel and the run goes on without it; a base that cannot be read refuses the Start.

## 6. Verify the deployment

```bash
npx wrangler secret list                                # shows APP_TOKEN (and GITHUB_TOKEN, if set)
npx wrangler containers list                            # shows the BuildExecutor container
npx wrangler artifacts repos list --namespace default   # empty until the first run
npx wrangler tail qwen-control-plane-v4 --format pretty # live logs, leave running during a run
```

## 7. Start a run

1. Open the Worker URL. The page creates a room ID and adds it to the URL as `?room=...`. Each room is its own `ControlRoom` Durable Object, so bookmark the URL to come back to the same room.
2. Paste your `APP_TOKEN` into **Access token**.
3. Edit **Problem statement** if you like. The default is just the product: "Build a small issue tracker that lets someone create, view, update, and delete tickets." Write the product you want, not instructions to the agents; the runtime's prompts already tell them how to split, write and link.
4. Choose the runtime settings. They apply to this room on **Start** and **Continue**:

   | Setting | Default | Range | Meaning |
   |---|---|---|---|
   | Turn budget | 100 | 1–500 | Agent turns this Start or Continue may spend. A manager's turn does not count, unless it asks the manager's model to decide problems: that costs one. |
   | Concurrent agents | 16 | 1–64 | Agent turns that run at the same time. |
   | Total agents | 64 | 2–256 | Workers and managers in the tree. Builders, the compiler and retired agents do not count. |
   | Recursion depth | 10 | 1–16 | Maximum tree depth. |
   | Generative agent model | Qwen3 A3B | Qwen3 A3B, Llama 3.2 1B, Qwen 3.8 27B | Writes splits and their promised functions, code, link edits, managers' decisions, the API coverage mapping, triage and runner tests. |
   | Split decision model | Clef-flash | Clef-flash, Clef | Answers the YES/NO questions as probabilities: the split gate, each child's scope, each function name a split adds, routing, the prune walk, which function answers a worker's request, and a retask's new task. |
   | Minimum YES probability | 70% | 20–80% | Clef split threshold. |

   The generative model is chosen here, per room, or with `settings.model` in the API. Rooms do not read the `MODEL_NAME` variable in `wrangler.jsonc`, so editing it does not change the model.

5. Press **Start**. This clears the room's state and creates Root. The runtime appends one requirement to your problem statement, so you do not need to write it:
   > The finished application has one entry module that exports start(); start() takes no arguments and returns an object with one method per operation named above. Modules get what they need from other modules only by importing it. Importing a module does no work at load: no reading process.argv, starting a server or prompting.

   The splitters assign that requirement like any other, and Root promises `start`: its split must give `start` to exactly one child. While the run is going, **Start** becomes **Stop**. Stop starts no new turns; the running ones finish, and then the room pauses (**Stopping** until then). **Continue** resumes it.

The dashboard refreshes every 3 seconds. It shows:
- **The ownership tree**, as circles coloured by role: managers, workers and the compiler. A manager's circle splits in half while its builder works on the branch. Green lines mark a branch whose agents are all done, and a green ring marks one its builder has linked. Click a circle to see, below the tree, its task and a `promises:` line with the functions it promised.
- **Agent traffic:** the latest 300 events, newest first.
- **The files** the room has recorded, committed or staged for the current turn's commit. Click one to read its content from the room's index of Artifacts writes.
- **The Container build panel**, with the latest Container report.

A run ends in one of three states:
- **complete**, when the compiler's runner test passes on the current source and every agent is done;
- **failed**, when an agent fails for good, for example when Root runs out of repair rounds;
- **paused**, when the budget is spent or every remaining agent is waiting.

**Continue** resumes a paused run with a new budget. It also:

- retries agents paused after three failures;
- reopens splits that were blocked for capacity, if you raised the limits;
- relinks a waiting builder, at any level, with a fresh relink budget;
- runs the compiler again on the current bundle, or retries it after a Container infrastructure failure;
- wakes every manager that still holds an open problem, or a function request that a restart left without a next hop;
- in a room with promises, wakes a worker that waits with no request open, no unread message and no source;
- pushes any files still staged.

**Clear room state** deletes the room's state. Its Artifacts repositories remain.

## 8. Export a run

**Export observation JSON** downloads `recursive-control-plane-<first 8 characters of the room>.json` from `/api/export`. It contains:
- the room snapshot and every agent;
- every file the room has recorded, with its content;
- every problem with its decisions, and every repair ticket;
- each manager's linking state and the compiler's state;
- up to 20,000 events. The agents' Artifacts remote URLs include your account ID, so review an export before you share it.

### Getting the code out

Once Root's builder has linked the application and the compiler has chosen its entry, the room holds runnable code: the workers' modules under `components/` as Root's builder linked them, and from the compiler the runtime loader `glue/index.js`, `package.json` and the runner's test `glue/smoke.js` once it has been written. The export adds a `README.md` with the goal, the run status and how to run it. Assembly metadata (`assembly.manifest.json`, `assembly.boundary.json`, `compile.manifest.json`) and agent notebooks are left out. When Clef judged the whole goal atomic, Root writes the code itself and there is no builder: the export is then Root's own files, and its README gives the package scripts the Container runs, or a command that loads the entry module and calls `start()`.

- **Download app (.zip)** saves `recursive-app-<first 8 characters of the room>.zip` from `/api/app.zip`.
- **`POST /api/export/github`** takes `owner/repo`, pushes the application to a new branch `control-plane/<first 8 characters of the room>` (`-2`, `-3` and so on if the name is taken) with the files under `apps/<first 8 characters of the room>/`, and opens a pull request against the repository's default branch. It returns the pull request's URL, or the branch's when there is none. The dashboard's **Push to GitHub** button, which does the same, is hidden for now. On the new branch that directory holds exactly the exported files: files an earlier export left there are removed, and the pull request says so. Nothing outside it changes, and nothing is ever force-pushed. With `dir` set to `.` the files go to the repository root, next to the repository's own files; if that would change a file the repository already has (its `README.md` or `package.json`, say), the export is refused with `409` and the names of those files. In an empty repository the new branch becomes its first branch, and no pull request is opened because there is no base branch.

The Worker clones the base branch at depth 1 into memory without checking it out, builds the new commit from the base's trees, and pushes only the objects the base does not already have. Peak memory is about four times the base branch's packed size, so a base branch up to about 20 MB packed fits in a Worker's 128 MB. For a larger repository, export into an empty or smaller repository, or download the ZIP.

The run status says whether the last passing Container run hashed exactly the exported files. If anything changed after that run, or no run has passed, the README, the commit message and the pull request say **UNVERIFIED**. The app needs only Node.js 22 or newer and its built-ins:

```bash
unzip recursive-app-demo-roo.zip -d app && cd app
node -e "require('./glue/index.js').start().then(app=>console.log(Object.keys(app)))"
node glue/smoke.js
```

Before there is an application (Root's builder has not linked one, the compiler has not written its loader, or an atomic Root has not written code) these routes return `409` with `No application yet`. A complete or failed room that never had one returns `409` with `No application to export`; start a new room.

### Using the API directly

Every route takes the token as `Authorization: Bearer <APP_TOKEN>`. A room ID is 8–64 characters of letters, digits and `-`. `GET` routes take the room as `?room=`, and `POST` routes take it in the JSON body.

| Route | Purpose |
|---|---|
| `GET /api/state?room=` | Dashboard snapshot |
| `GET /api/export?room=` | Full export |
| `GET /api/file?room=&agent=&path=` | One file an agent wrote, from the room's index of its Artifacts writes |
| `POST /api/run` | `{room, goal, budget, settings, base?}`: start a new run. The goal must be 8–1800 characters. `base` (v8 pipeline only) is `{repo: "owner/name", ref?}` for a public GitHub repo or `{room: "<room id>"}` for a room's previous result. |
| `POST /api/continue` | `{room, budget, settings}`: resume a run |
| `POST /api/stop` | `{room}`: stop a run. No new turns start; the running ones finish, then the room pauses (`status: paused`, event `stopped`) and the snapshot's `stopping` is `true` until then. Returns `{status: "stopping"}`, or `{error: "Nothing is running"}`; `/api/continue` resumes it |
| `POST /api/reset` | `{room}`: clear the room's state |
| `GET /api/app?room=` | The application as JSON: `files` (`[{path, content}]`, README first), `passed`, `fingerprint`, `digest` and `note`, plus `room`, `goal`, `room_status`, `agents`, `entry` and `kind` (`linked` by the builders and run by the compiler, or `atomic` when Root wrote it); `fingerprint` names what the passing run compiled |
| `GET /api/app.zip?room=` | The same files as a ZIP download; the `x-app-passed` header is `true` or `false` |
| `POST /api/export/github` | `{room, repo, branch?, dir?, pr?, base?}`: push the application to a new branch of `repo` (`owner/name`) and open a pull request unless `pr` is `false`. `branch` defaults to `control-plane/<room8>`, `dir` to `apps/<room8>/` (`.` is the repository root; `..` and absolute paths are refused), `base` to the repository's default branch. Returns `{branch, commit, pr_url, branch_url, files, passed, replaced}`; `replaced` is `true` when `dir` already held files on the base branch. Needs the `GITHUB_TOKEN` secret |

```bash
URL=https://qwen-control-plane-v4.<your-subdomain>.workers.dev
APP_TOKEN='<the value you stored with wrangler secret put>'
curl -sS -X POST "$URL/api/run" -H "Authorization: Bearer $APP_TOKEN" -H 'content-type: application/json' \
  -d '{"room":"demo-room-0001","goal":"Build a small issue tracker that lets someone create, view, update, and delete tickets.","budget":100,"settings":{"parallel":16,"max_agents":64,"max_depth":10}}'
curl -sS "$URL/api/export?room=demo-room-0001" -H "Authorization: Bearer $APP_TOKEN" > run.json
curl -sS -OJ "$URL/api/app.zip?room=demo-room-0001" -H "Authorization: Bearer $APP_TOKEN"   # saves recursive-app-demo-roo.zip
curl -sS -X POST "$URL/api/export/github" -H "Authorization: Bearer $APP_TOKEN" -H 'content-type: application/json' \
  -d '{"room":"demo-room-0001","repo":"your-name/your-repo"}'
```

`settings` accepts `parallel`, `max_agents`, `max_depth`, `model`, `split_model` and `split_threshold` (0.2–0.8, default 0.7), with the same limits as the dashboard. When `budget` is left out, it defaults to 20.

## Troubleshooting

- **`503 Set APP_TOKEN ...`**: the secret is not set; see step 5. **`401 Invalid APP_TOKEN`**: the token in the dashboard does not match the secret.
- **`400 Invalid room`**: the room ID must be 8–64 letters, digits or `-`.
- **`409 No application yet`** from `/api/app`, `/api/app.zip` or `/api/export/github`: Root's builder has not linked the application, the compiler has not written its loader (for example while no module exports `start()`), or an atomic Root has not written code. Continue the run until it does. **`409 No application to export`**: the room is complete or failed without an application; start a new room. **`409 ... already has ...`** from `/api/export/github`: exporting to the repository root would change the repository's own files; pass a `dir`. **`409 ... nothing to push`**: that directory already holds exactly these files.
- **`503 Set GITHUB_TOKEN ...`**: the optional GitHub secret is not set; see step 5. **`502 GitHub ...`**: GitHub refused the export, and the message (with `github_status`) says why: `401` means the token is invalid or expired, `403` that it lacks Contents or Pull requests write access to that repository, `404` that the repository does not exist or the token cannot see it, and `422` that GitHub rejected the pull request. When the pull request fails after the push, the message names the branch that was pushed. When GitHub declines the push itself, the message ends with what GitHub said, for example `GH006` (a protected branch) or `GH013` (repository rules).
- **Deploy fails with "The Docker CLI is needed to build the configured image"**: start Docker. With Podman, set `WRANGLER_DOCKER_BIN` and `DOCKER_HOST` as Wrangler suggests. `npx wrangler deploy --containers-rollout=none` deploys the Worker without the Container, but then Root cannot run the application and the build panel reports **EXECUTOR UNAVAILABLE**.
- **Build panel shows EXECUTOR UNAVAILABLE, or a `build_infrastructure` event appears**: the Container is not ready or failed to start. The Worker can be live before its Container is provisioned. Check `npx wrangler containers list`, and watch `wrangler tail` for `Build container exec not ready`, `Build container command exceeded` or `Build process termination failed`. An infrastructure failure blames no worker; the compiler waits (`build_blocked`). Once the Container is up, **Continue** clears the block and the compiler runs the current bundle again.
- **`split_capacity_blocked`**: Clef chose to split, but the room has no agent slots or depth left. Raise **Total agents** or **Recursion depth** and press **Continue**.
- **`split_rejected`, "The proposed functions fail … check(s)"**: the split did not give each function its node promised to exactly one piece. The next turn keeps Clef's YES and gives the splitter its partition back. Bad names in a split are deleted, never the piece (`interfaces_repaired`, `interfaces_stripped`, `interfaces_owned_elsewhere`).
- **A worker `waiting` after `route_request` or `done_deferred`**: it asked its manager for functions and waits for the answers (`route_provided`, `route_up`, `route_unowned`). A request climbs one level per manager turn, and only the last answer wakes the worker. **Continue** wakes a manager holding a request that a restart left without a next hop.
- **`contract_missing`**: a worker reported done without exporting a function it promised, and was sent back (at most three times). **`contract_unmet`**: the fourth done was accepted, and a `contract` problem went to its manager.
- **`repair_unchanged`**: a worker answered its repair ticket as done without changing a file. The ticket goes back once, saying so; a second unchanged answer closes the problem unfixed.
- **`api_incomplete`**: `start()` has no method for an operation the goal names, and the entry module's worker hears which. **`coverage_unchecked`** or **`api_planned`**: the coverage model gave no usable mapping. With promises, the runner then tests the plan's operation functions that `start()` returned.
- **`runner_retry`, then `runner_failed`**: the runner could not write a valid test in three attempts, twice. No worker is blamed; **Continue** retries.
- **`paused` event, "Stopped automatic retries after 3 failures"**: the agent failed three turns in a row; the `error` events before it give the reason. **Continue** retries it. A worker below Root whose three failures were all the code gate's does not pause. A `stuck` event files it with its manager, which retasks it to plain JavaScript (for TypeScript, JSX or a package import), tells it what to write, retires it, or escalates. It pauses only if no manager above settles it.
- **`Artifacts ... failed for rc-...`**: a git step on that agent's repository failed. The word after `Artifacts` names the step: `refs` (asking the repository whether `main` exists), `clone`, `init`, `write`, `stage`, `commit` or `push`. For a worker, the files staged in that turn are rolled back and the action replays from its first write. For a manager or builder, the files stay staged and are pushed at the next flush (a `commit_failed` event). Three failures in a row pause a worker, and **Continue** retries it. If every write fails, run the probe from step 3.
- **`recovered` event, "Durable Object restarted during a run"**: the room was evicted mid-run and is now paused. **Continue** resumes interrupted turns from their saved position.
- **`Experiment already running`**: a run is in progress in this room. Wait for it to pause, or use another room.
- **Status stays paused with a builder or the compiler `waiting`**: its problems are with its manager (`problems_reported`, then `problem_assigned` or `problem_escalated`) and nothing has changed yet, or the runner could not write a valid test (`runner_failed`). **Continue** relinks waiting builders with a fresh relink budget, runs the compiler again, and has every manager decide the problems it still holds.
- **`repair_exhausted` and a failed run**: a manager ran out of repair rounds (6 per manager, and 8 plus 2 per manager for the run, at most 40), or a problem was closed without a fix while its reporter waited on it, for example after a worker answered it twice without changing a file. The `problem_exhausted` and `problem_escalated` events before it say which. Start a new experiment.
- **`This room was started by a version before v7.14 and is not migrated`**: **Continue** refuses rooms from earlier versions. **Start** resets the room.

## Costs and cleanup

Every run creates one Artifacts repository per agent, builders and the compiler included, named `rc-<random>-<agent id>`. Neither the app nor **Clear room state** ever deletes them. A run also makes many Workers AI calls and starts a Container for the compiler: Qwen for splits, code, links, managers' decisions, the coverage mapping and tests, and Clef for each gate, each level of the prune walk, and each function request a manager cannot answer by name. All of this is billed to your account. To find and delete old repositories:

```bash
npx wrangler artifacts repos list --namespace default
npx wrangler artifacts repos delete <name> --namespace default
```

## Local development

Local `wrangler dev` (`npm run dev`) is not a supported way to evaluate this project, so deploy to your account instead. Setting `MOCK_AI` to `"true"` in `wrangler.jsonc` switches to a deterministic fake model. That mode still uses the older builder path and exists for the regression tests (`npm test`), not as a demo.

## Upgrading an existing deployment

The Worker name `qwen-control-plane-v4` and the Durable Object class names `ControlRoom`, `ManagerShard` and `BuildExecutor` are kept from earlier releases. An existing deployment therefore upgrades in place, keeping its rooms, its `APP_TOKEN` secret and its Artifacts repositories:

```bash
git pull
npm ci
npm run deploy
```

Start a new experiment after upgrading. A room started before v7.14 cannot be continued: **Continue** refuses it, and **Start** resets it. A room started on v7.14 can be continued, and keeps v7.14's behavior: it has no promises, so its workers do not ask for functions and its builders and compiler do not read a plan.

The name is only kept for continuity. For a separate new deployment, change `"name"` in `wrangler.jsonc`, or run `npx wrangler deploy --name <new-name>`. A Worker with a different name gets its own Durable Objects and needs its own `APP_TOKEN` (`npx wrangler secret put APP_TOKEN --name <new-name>`). Do not rename the Durable Object classes on an existing Worker: its stored rooms would be left behind.

Version-specific upgrade notes from earlier releases are in [docs/history/INSTALL-history.md](docs/history/INSTALL-history.md).
