# Recursive Control Plane

My entry for Cloudflare's "build the next Git platform" competition.

## Run it

Requirements: Node.js 22.13 or newer, Docker running locally, and a Cloudflare account with Workers AI, Artifacts, Durable Objects and Containers (Containers need the Workers Paid plan).

```bash
git clone https://github.com/tyrtop-ai/cloudflare-comp.git
cd cloudflare-comp
npm ci && npm test                  # local checks with fakes; no Cloudflare account needed
npx wrangler login
npm run deploy                      # Docker must be running: this builds the Container image
npx wrangler secret put APP_TOKEN   # any long random string
```

Open the `workers.dev` URL that Wrangler prints, paste in your token and press **Start**. You can watch the tree grow, click any agent to see what it talks to, and download the finished app as a zip. [INSTALL-CLOUDFLARE.md](INSTALL-CLOUDFLARE.md) covers the Artifacts namespace, the API, exports and troubleshooting.

## The idea

The idea behind it is that many small agents beat one big orchestrator agent with limited context. Context windows are a hard limit, so instead of fighting them with bigger models, the architecture keeps every agent's context small: no agent here ever holds the whole project.

The second intuition is that many small agents working on the same distributed problem will independently come up with solutions that are similar enough to need only minimal tape-up. So the pieces are joined by a builder that is only allowed to rename things, never to write code.

And the architecture should be symmetrical: problems and solutions are mirrors of each other. The same tree and the same plan that build the code are what route a failure back to the agent that has to fix it.

## The short version

- You type a goal ("build a small issue tracker that lets someone create, view, update, and delete tickets") and press Start.
- A tree of agents splits the work, writes the pieces, links them together and runs the result in a container.
- Every agent has its own git repo on Cloudflare Artifacts. Nobody shares a branch, so nothing ever gets merged and nothing ever conflicts.
- When the test fails, the failure gets routed back to the agent whose code is wrong, not to some bigger model.
- You get a working app you can download as a zip.

The issue tracker goal now finishes on its own in 2 to 6 minutes, with the test passing.

## Lots of small agents instead of one big one

<a href="docs/diagrams/small-agents.svg"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/small-agents-dark.svg">
  <img alt="Left: one orchestrator whose single context overflows with the whole codebase, the plan, every review and the next feature. Right: a tree of small agents: Root and its builder, a Manager with its builder and Workers A and B, and Worker C under Root. The Manager's view, in orange, reaches one level: its parent, its builder and its two workers." src="docs/diagrams/small-agents.svg" width="100%">
</picture></a>

The usual approach is one orchestrator that holds the whole codebase, the plan and every review in its head. That falls over once the project gets big.

Here, every agent only sees one level of the tree. A worker sees its task and the function names it has to export. A manager sees its direct children. Nobody reads the whole app. If a piece is still too big, its manager splits it again, up to 7 pieces at a time.

## Name things first, then joining is just renaming

<a href="docs/diagrams/tape-not-glue.svg"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/tape-not-glue-dark.svg">
  <img alt="1: Root's split promises names to each piece (Data: addTicket, getTickets; Create: createTicket; Entry: start). 2: written apart, createTicket.js imports addTicket from './data', and data.js exports addTicket and getTickets. 3, in orange: the builder's only edit is the import path, made with no model call because only data.js exports addTicket." src="docs/diagrams/tape-not-glue.svg" width="100%">
</picture></a>

Before any code is written, the split decides what each piece will export: `createTicket`, `readTickets`, `start`, and so on. Because everyone agreed on the names up front, pieces written separately already fit together.

That means the builder that joins them doesn't have to write any code. It's only allowed to fix import paths and names, and every edit it makes is checked token by token. Most of the time it doesn't even need a model call.

## Problems move one level at a time

<a href="docs/diagrams/one-level.svg"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/one-level-dark.svg">
  <img alt="The same tree, with the compiler above Root. Orange messages: (1) Worker B's ask for getTickets climbs from Manager to Root, whose child Worker C promises it, and the answer comes back down the same hops; (2) Manager's builder reports a problem between Workers A and B, and Manager settles it with a ticket to Worker A; (3) the compiler reports a failed test to Root." src="docs/diagrams/one-level.svg" width="100%">
</picture></a>

If a worker needs a function it doesn't have, it asks its manager. The ask climbs the tree until some manager's child has promised it, and the answer comes back down.

Problems work the same way in reverse. A failed test turns into a requirement, and the managers route it down to whoever promised the broken function. Fixing things uses the same map that built them.

## Check everything, cheaply

<a href="docs/diagrams/the-loop.svg"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/the-loop-dark.svg">
  <img alt="The loop. Clef decides whether to split; Qwen splits and names functions; Clef checks each child's scope, dropping a child out of scope, and each child repeats the loop. A node that does not split is a worker: it asks its manager for functions, Qwen writes code, and the code must parse and export its promise. The builder renames only, under a token check, then the compiler runs the fixed test. Failures go back, dashed, to the lowest common manager and as a ticket to the owner; a manager stops after 3 rounds in a row without progress. The checks are orange." src="docs/diagrams/the-loop.svg" width="100%">
</picture></a>

Every step ends in a check. Did the split make sense? Does the code parse? Does it export what it promised? Does it await the things it should? Does the app load, and does the test pass?

The yes/no questions go to Clef, a classifier that answers with a probability, so every gate is just a threshold. Anything that fails goes back around the loop to the step that can fix it. A manager gives up after three rounds in a row with no progress.

## A few other choices

- One git repo per agent and one commit per turn.
- The first test the runner writes stays fixed for the whole run, so repairs can't move the goalposts.
- Everything runs on Cloudflare: Workers, Durable Objects (one per room and one per manager), Workers AI, Artifacts and Containers.
- You can pick separate models for managers, workers and the compiler, and set how many pieces a split can have.

## v8 (experimental)

v7 can only build one kind of thing: a JavaScript app whose entry exports `start()`. v8 is a second pipeline you pick per room, meant to build whatever the goal asks for.

- First the goal becomes a project card: the deliverables, plus a check for each requirement, all written before any code.
- Workers can write any text file, in any language the Container has installed. Today that's Node and Python.
- The checks run in the Container: files, commands, function calls, HTTP requests and a headless browser. Docs get a reader instead: Clef reads the file and answers yes or no.
- When a check fails, it goes back as a repair to the piece that serves that requirement, the same way v7 routes a failed test.
- Links written in the goal are read once at the start. A run can also start from a public GitHub repo or the room's previous result.
- Queuing follow-up prompts on a finished room is in progress.
- A benchmark mode runs HumanEval, MBPP or MultiPL-E tasks, one room per task, with the tests hidden from every agent.

## Where it's at

The issue tracker works end to end on v7. A bigger goal, a network diagnostics engine with 20 rules, splits, links and runs, but doesn't pass its test yet.

v8 is built and tested offline, with scripted models standing in for Workers AI and the real Container scripts running in Node. It hasn't had a live run yet. [docs/trying-v8.md](docs/trying-v8.md) is the checklist for the first ones.

The history of live runs and fixes is in [docs/how-it-works.md](docs/how-it-works.md#status).

## More

- [docs/how-it-works.md](docs/how-it-works.md): the full mechanism (v7 and v8), the Cloudflare products, every live run, known limitations and the repository layout.
- [INSTALL-CLOUDFLARE.md](INSTALL-CLOUDFLARE.md): deploying, the API and exports.
- [CHANGELOG-v8.md](CHANGELOG-v8.md): the v8 slices and what each review changed.
- [docs/trying-v8.md](docs/trying-v8.md): a checklist for the first live v8 runs.
- [CHANGELOG-v7.15.md](CHANGELOG-v7.15.md), [v7.14](CHANGELOG-v7.14.md), [v7.13](CHANGELOG-v7.13.md): what changed, with the evidence behind each change.
- [docs/history/](docs/history/): earlier changelogs and READMEs.
- [docs/diagrams/](docs/diagrams/): Excalidraw scenes (open at excalidraw.com); after an edit, export light and dark SVGs with fonts embedded.

## License

MIT, see [LICENSE](LICENSE). The vendored Acorn parser is MIT licensed, see [src/vendor/ACORN-LICENSE](src/vendor/ACORN-LICENSE). The fonts embedded in the diagrams are under the SIL Open Font License, see [docs/diagrams/fonts/](docs/diagrams/fonts/).
