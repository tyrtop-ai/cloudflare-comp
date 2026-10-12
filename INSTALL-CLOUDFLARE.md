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
- builds the Container image from `container/Dockerfile` (Node 22, `build-runner.mjs`) and deploys it with up to 4 instances.

Wrangler prints the Worker URL, `https://qwen-control-plane-v4.<your-subdomain>.workers.dev`. Cloudflare provisions the Container separately, so it can take a few minutes after a successful deploy before it is ready:

```bash
npx wrangler containers list
```

Always deploy with `wrangler deploy` (`npm run deploy`). `wrangler versions upload` does not deploy Container changes.

## 5. Set the access token

The API requires a bearer token stored as a Worker secret:

```bash
npx wrangler secret put APP_TOKEN
```

Paste a long random value, for example the output of `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`. Keep it out of Git. Until the secret is set, every `/api/*` request returns `503` with `Set APP_TOKEN with wrangler secret put APP_TOKEN`; the dashboard page itself still loads. `wrangler secret put` publishes a new Worker version, so no extra deploy is needed.

## 6. Verify the deployment

```bash
npx wrangler secret list                                # shows APP_TOKEN
npx wrangler containers list                            # shows the BuildExecutor container
npx wrangler artifacts repos list --namespace default   # empty until the first run
npx wrangler tail qwen-control-plane-v4 --format pretty # live logs, leave running during a run
```

## 7. Start a run

1. Open the Worker URL. The page creates a room ID and adds it to the URL as `?room=...`. Each room is its own `ControlRoom` Durable Object, so bookmark the URL to come back to the same room.
2. Paste your `APP_TOKEN` into **Access token**.
3. Edit **Problem statement** if you like. The default asks for a small issue tracker with create, view, update and delete.
4. Choose the runtime settings. They apply to this room on **Start** and **Continue**:

   | Setting | Default | Range | Meaning |
   |---|---|---|---|
   | Turn budget | 100 | 1–500 | Agent turns this Start or Continue may spend. Manager routing turns do not count. |
   | Concurrent agents | 16 | 1–64 | Agent turns that run at the same time. |
   | Total agents | 64 | 2–256 | Workers and managers in the tree. Builders do not count. |
   | Recursion depth | 10 | 1–16 | Maximum tree depth. |
   | Generative agent model | Qwen3 A3B | Qwen3 A3B, Llama 3.2 1B, Qwen 3.8 27B | Writes splits, code, link edits, triage and runner tests. |
   | Split decision model | Clef-flash | Clef-flash, Clef | Answers the split, scope and routing YES/NO questions. |
   | Minimum YES probability | 50% | 20–80% | Clef split threshold. |

5. Press **Start new experiment**. This clears the room's state and creates Root.

The dashboard refreshes every 3 seconds. It shows the ownership tree, agent traffic (the latest 300 events), the files the room has recorded, committed or staged for the current turn's commit (click one to read its content from the room's index of Artifacts writes), and the **Container build** panel with the latest Container report.

A run ends **complete** when Root's runner test passes, **failed** when an agent fails for good, or **paused** when the budget is spent or every remaining agent is waiting. **Continue** resumes a paused run with a new budget. It also:

- retries agents paused after three failures;
- reopens splits that were blocked for capacity, if you raised the limits;
- relinks a waiting builder;
- retries after a Container infrastructure failure;
- pushes any files still staged.

**Clear room state** deletes the room's state. Its Artifacts repositories remain.

## 8. Export a run

**Export observation JSON** downloads `recursive-control-plane-<first 8 characters of the room>.json` from `/api/export`. It contains the room snapshot, every agent, every file the room has recorded with its content, and up to 20,000 events. The agents' Artifacts remote URLs include your account ID, so review an export before you share it.

### Using the API directly

Every route takes the token as `Authorization: Bearer <APP_TOKEN>`. A room ID is 8–64 characters of letters, digits and `-`. `GET` routes take the room as `?room=`, and `POST` routes take it in the JSON body.

| Route | Purpose |
|---|---|
| `GET /api/state?room=` | Dashboard snapshot |
| `GET /api/export?room=` | Full export |
| `GET /api/file?room=&agent=&path=` | One file an agent wrote, from the room's index of its Artifacts writes |
| `POST /api/run` | `{room, goal, budget, settings}`: start a new run. The goal must be 8–1800 characters. |
| `POST /api/continue` | `{room, budget, settings}`: resume a run |
| `POST /api/reset` | `{room}`: clear the room's state |

```bash
URL=https://qwen-control-plane-v4.<your-subdomain>.workers.dev
curl -sS -X POST "$URL/api/run" -H "Authorization: Bearer $APP_TOKEN" -H 'content-type: application/json' \
  -d '{"room":"demo-room-0001","goal":"Build a small issue tracker that lets someone create, view, update, and delete tickets.","budget":100,"settings":{"parallel":16,"max_agents":64,"max_depth":10}}'
curl -sS "$URL/api/export?room=demo-room-0001" -H "Authorization: Bearer $APP_TOKEN" > run.json
```

`settings` accepts `parallel`, `max_agents`, `max_depth`, `model`, `split_model` and `split_threshold` (0.2–0.8), with the same limits as the dashboard. When `budget` is left out, it defaults to 20.

## Troubleshooting

- **`503 Set APP_TOKEN ...`**: the secret is not set; see step 5. **`401 Invalid APP_TOKEN`**: the token in the dashboard does not match the secret.
- **`400 Invalid room`**: the room ID must be 8–64 letters, digits or `-`.
- **Deploy fails with "The Docker CLI is needed to build the configured image"**: start Docker. With Podman, set `WRANGLER_DOCKER_BIN` and `DOCKER_HOST` as Wrangler suggests. `npx wrangler deploy --containers-rollout=none` deploys the Worker without the Container, but then Root cannot run the application and the build panel reports **EXECUTOR UNAVAILABLE**.
- **Build panel shows EXECUTOR UNAVAILABLE, or a `build_infrastructure` event appears**: the Container is not ready or failed to start. The Worker can be live before its Container is provisioned. Check `npx wrangler containers list`, and watch `wrangler tail` for `Build container exec not ready`, `Build container command exceeded` or `Build process termination failed`. An infrastructure failure blames no worker; once the Container is up, **Continue** clears the block and Root's builder relinks and reruns the current source.
- **`split_capacity_blocked`**: Clef chose to split, but the room has no agent slots or depth left. Raise **Total agents** or **Recursion depth** and press **Continue**.
- **`paused` event, "Stopped automatic retries after 3 failures"**: the agent failed three turns in a row; the `error` events before it give the reason. **Continue** retries it.
- **`Artifacts ... failed for rc-...`**: a git clone, commit or push to that agent's repository failed. For a worker, the files staged in that turn are rolled back and the action replays from its first write. For a manager or builder, the files stay staged and are pushed at the next flush (a `commit_failed` event). Three failures in a row pause a worker, and **Continue** retries it. If every write fails, run the probe from step 3.
- **`recovered` event, "Durable Object restarted during a run"**: the room was evicted mid-run and is now paused. **Continue** resumes interrupted turns from their saved position.
- **`Experiment already running`**: a run is in progress in this room. Wait for it to pause, or use another room.
- **Status stays paused with builders `waiting`**: problems were sent back to workers and nothing has changed yet, or the runner could not write a valid test. **Continue** relinks with a fresh relink budget.

## Costs and cleanup

Every run creates one Artifacts repository per agent, builders included, named `rc-<random>-<agent id>`. Neither the app nor **Clear room state** ever deletes them. A run also makes many Workers AI calls (Qwen for splits, code, links and tests, plus Clef for each gate) and starts a Container at Root. All of this is billed to your account. To find and delete old repositories:

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

Start a new room after upgrading. An existing room keeps its agents' earlier state.

The name is only kept for continuity. For a separate new deployment, change `"name"` in `wrangler.jsonc`, or run `npx wrangler deploy --name <new-name>`. A Worker with a different name gets its own Durable Objects and needs its own `APP_TOKEN` (`npx wrangler secret put APP_TOKEN --name <new-name>`). Do not rename the Durable Object classes on an existing Worker: its stored rooms would be left behind.

Version-specific upgrade notes from earlier releases are in [docs/history/INSTALL-history.md](docs/history/INSTALL-history.md).
