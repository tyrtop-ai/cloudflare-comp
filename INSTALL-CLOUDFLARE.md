> **v7.10 upgrade:** Builders remain join-only: runtime-owned deterministic entrypoint and package, Qwen-owned `glue/wiring.js` and Root `glue/smoke.js`. The runtime now schedules missing joint files even if a builder returns `files: []`, and retries failed wiring directly without altering leaf code. `ApplicationBootstrapper` is recognized as assembly-only when appropriate. **185/185 local tests passed; live Cloudflare not verified.** See `CHANGELOG-v7.10.md`.

> **v7.9 upgrade:** Root builders must publish both `glue/wiring.js` and a behavioral `glue/smoke.js`. The isolated Container runs `node glue/smoke.js` independently of npm scripts, and rejects disconnected CRUD stores even when modules import cleanly. Qwen is instructed to choose one shared storage instance and inject it into every dependent handler. A smoke failure routes to the builder first. See `CHANGELOG-v7.9.md`. **182/182 local tests passed; live Cloudflare not verified.**

> **v7.8 upgrade:** Root's builder receives a runtime-generated `glue/index.js` and `package.json`; Qwen generates ONLY `glue/wiring.js`. Builders preserve wake generations during active turns, and Continue requeues an idle builder after all producers finish. Leaf output is native JavaScript only. The runtime continues to distinguish a diagnostic module load from a working integrated app. See `CHANGELOG-v7.8.md`. **178/178 local tests passed, live Cloudflare not verified.**

> **v7.7 upgrade:** The runtime builds a diagnostic linker directly from the committed assembly manifest and uses it as a separate Container fallback when Qwen glue fails validation. Import paths are exact; TypeScript-only interfaces are not imported as runtime values. A passing baseline only means modules load—it does **not** certify application correctness. See `CHANGELOG-v7.7.md`. Start a fresh room to compare v7.7 with earlier runs.

> **v7.5 upgrade:** A rejected split is now fed back to Clef for a fresh route decision; if Clef still votes to split, Qwen receives rejected child labels and scope probabilities to correct its partition. A Clef NO routes directly to code implementation. See `CHANGELOG-v7.5.md`; use a new experiment when comparing split behavior.

> **v7.4 upgrade:** Builder writes outside allowed glue paths now produce an actionable rejection fed back to Qwen. Room failures preserve their actual cause. Production Qwen splits no longer spawn an “Assemble components…” leaf; assembly belongs to the builder. See `CHANGELOG-v7.4.md`. Start a fresh experiment for changed split routing.

> **v7.3 upgrade:** Leaf source now defaults to Node built-ins and browser-native APIs. Third-party packages and guessed imports into another agent’s repository are rejected at publication; the builder wires functions passed in as collaborators. Start a new room to exercise the revised leaf prompts; prior committed code remains unchanged.

# Install and deploy — Cloudflare Recursive Code Control Plane v7.10

This updates the **existing** `qwen-control-plane-v4` Worker from earlier releases. It retains the Worker name, the Durable Object class names, the Artifacts namespace `default`, stored rooms, and any existing `APP_TOKEN` secret. Do **not** delete the existing Worker or run `wrangler init` over this code.

## Prerequisites

- Node.js 22+ and npm (`node --version`).
- Docker Engine running (`docker info`). The `BuildExecutor` image comes from `container/Dockerfile`; Wrangler builds/pushes it during deploy.
- Cloudflare account with **Workers AI, Artifacts, Durable Objects, and Containers access**.
- Cloudflare Wrangler login for the target account.

There is no Ollama/local model dependency. On Fedora, the Docker engine must be started before `npm run deploy`; a successful local Node test suite does **not** verify the remote Container can start.

## Upgrade (existing deployment)

```bash
unzip qwen-recursive-control-plane-v7.10-joint-only-builder-recovery.zip
cd qwen-control-plane-v7.10-cloud
npm install
npm test
npm run check
npx wrangler login            # skip if already authenticated
npx wrangler artifacts namespaces get default
docker info                  # must succeed
npm run deploy
```

Wrangler config deliberately retains `"name": "qwen-control-plane-v4"` and `ARTIFACTS` / `ROOMS` / `MANAGERS` / `BUILD_EXECUTORS` bindings. The `BuildExecutor` Container image is deployed with the Worker; **do not** use `wrangler versions upload` if you intend to deploy Container changes.

If the `APP_TOKEN` secret is already configured on this Worker, keep using it. To create or rotate it, run:

```bash
npx wrangler secret put APP_TOKEN
```

That command itself publishes a Worker version. For a first-time install it is okay to run it **after** the first `npm run deploy`: the API will return a 503 until the secret is set. The static dashboard remains viewable. Use a unique, long random token; never commit it to Git.

Verify after deployment:

```bash
npx wrangler secret list
npx wrangler containers list
npx wrangler artifacts repos list --namespace default
npx wrangler tail
```

The `repos list` command can show an empty namespace until an experiment creates its agents. The Worker URL is printed by `npm run deploy`.

Open that `workers.dev` URL, enter the same `APP_TOKEN`, and launch an experiment. After a Container-infrastructure failure, an existing room can be **Continued**: v7.0 attempts verification again without regenerating its existing builder source. The older `Invalid build fingerprint` error is corrected because the Container now receives a fixed-length SHA-256 attestation key.

**Cloudflare provisions Container instances separately from the Worker:** the Worker may deploy successfully before the Container is ready. Check Container status/logs when the build RPC reports an infrastructure error. A successful Cloudflare build is not proof that AI-generated CRUD behavior is complete.

## New installation

Use the same commands above. Make sure you have an Artifacts namespace called `default` (or update the `namespace` binding in `wrangler.jsonc` to match your namespace), and enable Workers AI/Artifacts/Containers on the account. Deploy and then set `APP_TOKEN`.

## Local development

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars to set APP_TOKEN to a long random token
npm run dev -- --var MOCK_AI:true
```

This uses the mock inference path and is not a live multi-agent verification. Depending on Artifacts support in local dev, `"remote": true` may be needed in the Artifacts binding in `wrangler.jsonc`. Do not confuse local mock tests with live Cloudflare Container validation.

## v7.3 — Current independent leaf code-writing behavior

See `CHANGELOG-v7.3.md`. Both leaf prompts prohibit importing external packages and guessing code paths owned by other agents. The source publication gate checks known imports against Node built-ins and the leaf's own authored files, including siblings in a multi-file response. The builder wires independently generated modules. In the mock app, the HTTP handler and executable entrypoint use Node built-ins without Express.

## v7.2 — Previous recursive code-writing behavior

See `CHANGELOG-v7.2.md` for the implemented corrections. Unlike the historical v7.0/v7.1 behavior below, the current Qwen splitter has natural fanout, Clef checks every proposed child, capacity limitations do not force a huge leaf to implement a task, and builders do not rerun inference on ordinary source changes. Workers can publish any number of required files without the earlier arbitrary 2/4-file quotas. **Continue** now applies updated room settings and can resume a capacity-blocked split if the new limits allow it.

## v7.0 — Historical behavior (superseded in v7.1–v7.2)

- Clef still decides whether code is divisible. Qwen still proposes the next 2–3 smaller code-writing modules when Clef says yes. Managers remain deterministic/Clef-assisted routers and **do not** write code or glue.
- Splitter output names source modules and their intended exports; children get only the code they were asked to implement, not speculative design work.
- Qwen implementers can publish actual files directly in their JSON decision, avoiding a separate inference for every file. The same applies to temporary builders' short glue/config files.
- Completion without source code, prose-only files, and missing explicitly assigned module filenames are rejected. The existing Container build and provenance repair process is unchanged.
- All existing Durable Object classes, bindings, Worker name, room state, and APP_TOKEN are retained. New rooms get the code-first splitter. Existing in-flight rooms retain already delegated task descriptions; deploy does not rewrite historic task state.

## v6.9 — Skip unused generated dependencies and route first module failure

- The verification Container scans literal `require()`, static/dynamic `import()`, and `from` specifiers across all assembled JS/TS source files. If a generated package declares dependencies but **no source imports external packages** and every npm script is a simple `node file.js` invocation, it skips `npm install` and records an `install-skipped` check. This also avoids wasting a network request on unused packages such as `express` in the supplied issue-tracker snapshot.
- Installation remains enabled for actually imported external dependencies, dynamic/nonliteral imports, and nontrivial scripts such as `vite build`, `npm run ...`, or chained shell commands. Genuine npm DNS and HTTP errors continue to block as infrastructure, not source failures.
- A CommonJS `MODULE_NOT_FOUND` failure uses the **first importer** from Node's require stack to identify the file that must be fixed; it no longer submits identical repair requests for all callers in the stack. Missing ESM named exports still route to the exporting leaf. Importing CSS with plain `require()` routes to the importing JS file.
- Build issue summaries now retain the leading error (`Cannot find module './storage'`) even when Node emits a long require stack.
- The supplied `recursive-control-plane-714644a7.json` export was reproduced locally: unused `express` was skipped, and verification correctly attributed the first failure to `components/fetch-tick-6fb27e95/fetchTicketData.js` because it requires a missing local `./storage`. The generated glue also tries to `require()` a CSS file; that will need correction when verification reaches it.
- This release does not install packages on your Cloudflare account, change the Artifacts source, or automatically repair those leaf implementations. Deploy this Worker upgrade and choose **Continue** to reverify the existing snapshot, then let owner-routed code repairs handle genuine source failures.

## v6.8 — Dependency install and module integration gates

- Root `package.json` with no `dependencies` and no `devDependencies`: no npm install stage at all.
- If dependencies are actually needed, the executor runs npm with `--ignore-scripts --no-audit --no-fund --loglevel=http`, a persistent tarball cache at `/work/npm-cache`, a bounded network fetch time, and 85-second install deadline.
- The install stage records stdout/stderr and its last HTTP progress messages. Timeouts and registry connectivity errors become infrastructure failures. The unchanged source can be retried by clicking **Continue**, without triggering another Qwen implementation pass.
- A package error such as an invalid dependency version is instead reported against `package.json` for source correction.
- When there is no compiler build script and `glue/index.js` exists, the Container executes a real `import('./glue/index.js')` with Node to catch missing named and default exports. Such an error is attributed to the file named by the module loader (e.g., `components/.../deleteRecords.js`).
- Static HTML and successful module import are not functional UI/browser tests. Successful builds still need meaningful tests to prove the user's requirements.

## v6.7 — Container execution fixes

- `ctx.container.start()` is called without options because the included `wrangler.jsonc` uses the **default** Container scheduling policy. The image is selected in Wrangler and outbound network access is enabled by default.
- A just-started Container may be unavailable briefly. `exec()` ordinarily waits for startup, but transient startup exceptions now retry with bounded backoff (250, 500, 750, 1000, 1500 ms), without issuing another model inference.
- The actual build process is started under GNU `timeout --signal=TERM --kill-after=5s 240s` so process groups are terminated on expiration. The Durable Object separately races the process's input/output lifecycle against a 255-second watchdog and calls `ExecProcess.kill(9)` if it wins. The Node runner also cleans up any independently detached npm command groups on SIGTERM.
- `setInactivityTimeout(120_000)` is guarded and nonfatal; the current Cloudflare API **does document** this method, but failure to set it must not fail a build.
- Failures from `exec()` and build results preserve their causes. Successful builds still require fingerprint and source-snapshot digest attestation.

The first cold build is expected to involve starting a Container. Watch Cloudflare Worker logs while reproducing errors:

```bash
npx wrangler tail qwen-control-plane-v4 --format pretty
```

Run **Continue** on the existing room only after deployment, and review the streamed Worker logs for `Build container exec not ready`, `Build process termination failed`, or `Build container command exceeded`. In the supplied `recursive-control-plane-cd748505.json` export, the latest pause also contains `Public export name would reveal hidden child IDs`; this is a *separate manager routing/export problem*, not evidence that Container startup failed.

## v6.6 builder-loop improvements

1. Full revision inventories are hashed before sending fingerprints to the Container RPC (fixes the 240-character validation failure).
2. Infrastructure-blocked assemblies do not consume speculative Qwen retries; explicit **Continue** re-verifies the unchanged committed bundle.
3. Oversized builder file outputs are corrected in the same bounded generation loop instead of failing outside the loop.
4. Source context is read once per file-operation retry group and builder generation is capped at 1,600 output tokens.
5. Byte-identical linker code does not create new Artifacts revisions or invalidate previously certified builds.

No production Cloudflare deployment was performed while preparing this patch; remote account access and Container entitlements still need to be verified on your account.

References:
- https://developers.cloudflare.com/containers/guides/deploy/
- https://developers.cloudflare.com/artifacts/get-started/workers/
- https://developers.cloudflare.com/workers/configuration/secrets/
