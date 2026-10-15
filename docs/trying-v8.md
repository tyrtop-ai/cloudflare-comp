# Trying v8

v8 has only run offline so far, against scripted models. This is a checklist for the first live runs, and what to look for in each one.

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

Root's first turn writes the project card. The **Project card** panel then shows the deliverables, the requirements (each with a pass, fail or untested chip) and the decisions the card writer made for you. If the room holds, the panel says why:

| Hold | Meaning | What to do |
|---|---|---|
| `card_blocked` | The goal needs something this deployment can't do (a language that isn't installed, or an edit with no repo given) | Read the text. Start again with a base or a different goal |
| `card_failed` | The card writer's answer didn't validate twice | Continue retries it |
| `checks_failed` | A requirement failed and no piece could fix it | Continue runs the checks again |
| `checks_blocked` | The checks couldn't run (Container, Chromium, Clef) | Retries itself after 30 s, 2 min and 10 min, then waits for Continue |
| `checks_exhausted` | The repair rounds ran out | Continue gives a fresh set of rounds |

## 3. Try these goals

**"Add a README explaining how to run it."** Set **Start from** to a public GitHub repo, a small one of yours.
- The **Sources and base** panel should show how many files were read and what was skipped.
- The card should have `README.md` as a doc deliverable with a judge check (Clef reads it and answers yes or no).
- If the repo already has a README, look for `card_base_dropped` or `base_change_refused`: Clef has to agree the goal asks to change that file.
- **Download app (.zip)** should be the repo plus the new README. `.recursive/RUN.md` lists what wasn't carried over.
- Optional: run the same goal with **Start from** set to nothing. It should stop at `card_blocked` and ask for a repo.

**"A Python CLI that converts temperatures."**
- The card should list `python`, a command deliverable and command checks.
- If a check fails, open the worker's repair ticket in the traffic panel. It should say what the program did, never what the check expected.
- In the export, check `state.toolchain_inventory`: it shows the Python and Node versions, and whether checks ran with the network off (`network`). The network can only be turned off where the Container allows user namespaces, and that has not been tested on a live Container yet.

**"A static web page with a to-do list."**
- The card should have a page deliverable (`index.html`), a static run, and browser checks.
- The browser checks are the most likely to hit infrastructure problems (Chromium starting on `standard-1`). A `checks_blocked` hold, or a check marked `infrastructure`, means the Container side failed, not the page.

**"Build a small issue tracker that lets someone create, view, update, and delete tickets."** (the old default)
- No `start()` requirement is added in v8. The card writer chooses a shape and writes the choice under **decisions**.
- If you have time, run the same goal in a v7 room to compare wall time, repair rounds and whether you'd use the result.

## 4. A small benchmark

In the **Benchmarks** panel:
- **Dataset URL:** the HumanEval rows URL shown in the field's placeholder (datasets-server.huggingface.co).
- **Tasks:** 10. **Rooms at once:** 2. **Keep task rooms:** the default (keeps the ones that didn't pass).
- Use the same model pickers and turn budget as for the rooms above.

Press **Run benchmark**. It keeps going with the page closed. Most HumanEval tasks should be atomic: Root writes the function itself. pass@1 counts only scored tasks. Errors (a Container that couldn't run, a stop, a card hold) are counted separately, so a high error count points at the platform, not the model.

## 5. What to send back

- **For each room:** **Export observation JSON**. It contains the card and its revisions, the requirement results, the problems and tickets, every event and every span. The spans are what the speed analysis reads: each model call (role, model, tokens), each Clef gate, each git phase, each Container run (cold or warm, and each check's ms), and dispatch delays. One thing to watch for: in a v8 room that splits, nothing pre-warms the Container yet, so the first check run probably pays a cold start (`cold: true` on its container span).
- **For the benchmark:** the JSON from `GET /api/bench?id=<run id>` (task outcomes, times, tokens, room ids), plus the room exports of one or two failed tasks.

**The room export contains your Cloudflare account id**, inside the Artifacts remote URLs. Don't commit it to this repo or post it anywhere public; send it privately. The benchmark status JSON contains no remote URLs or account ids.
