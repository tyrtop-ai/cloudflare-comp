# Recursive Control Plane

An entry for Cloudflare's "build the next Git platform" competition: many small agents build one codebase at the same time, and nothing is ever merged.

**A repeatable process stands in for intelligence.** The model that writes the code activates about 3B parameters per token and never holds the plan; the process around it does.

1. **Many small agents, one level each.** Workers write, managers split, builders join, one compiler runs the app.
2. **Names first, so joining is only renaming.** A split names the functions each piece exports, so pieces written apart already fit.
3. **One level at a time.** Asks and problems move only between parent and child.
4. **A cheap check after every step.** A failure goes back around the loop, never to a smarter model.

Every agent commits only to its own Artifacts git repository. Promised names replace agreed interfaces, mechanical checks replace review, and a problem inbox at each manager replaces issues. It runs entirely on Cloudflare: Workers, Durable Objects, Workers AI (Qwen3-30B-A3B writes, Clef-flash answers yes/no), Artifacts and Containers.

## Many small agents, not one orchestrator

<a href="docs/diagrams/small-agents.svg"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/small-agents-dark.svg">
  <img alt="Left: one orchestrator whose single context overflows with the whole codebase, the plan, every review and the next feature. Right: a tree of small agents: Root and its builder, a Manager with its builder and Workers A and B, and Worker C under Root. The Manager's view, in orange, reaches one level: its parent, its builder and its two workers." src="docs/diagrams/small-agents.svg" width="100%">
</picture></a>

One orchestrator holds the codebase, the plan and every review in one context. Here each agent reads one level of the tree: a worker sees its task, the names it must export and its manager; a manager sees its direct children by their exports. No model call reads the whole application.

## Names first, so joining is only renaming

<a href="docs/diagrams/tape-not-glue.svg"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/tape-not-glue-dark.svg">
  <img alt="1: Root's split promises names to each piece (Data: addTicket, getTickets; Create: createTicket; Entry: start). 2: written apart, createTicket.js imports addTicket from './data', and data.js exports addTicket and getTickets. 3, in orange: the builder's only edit is the import path, made with no model call because only data.js exports addTicket." src="docs/diagrams/tape-not-glue.svg" width="100%">
</picture></a>

The builder is tape, not glue: it may change an import path or a name, nothing else, and every edit is checked token by token. Because the plan named every function first, most links need no model call at all (run16: 11 renames, zero model calls). What renaming can't fix goes back to the module's owner.

## One level at a time; Root is the last stop

<a href="docs/diagrams/one-level.svg"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/one-level-dark.svg">
  <img alt="The same tree, with the compiler above Root. Orange messages: (1) Worker B's ask for getTickets climbs from Manager to Root, whose child Worker C promises it, and the answer comes back down the same hops; (2) Manager's builder reports a problem between Workers A and B, and Manager settles it with a ticket to Worker A; (3) the compiler reports a failed test to Root." src="docs/diagrams/one-level.svg" width="100%">
</picture></a>

A worker asks its manager for every function it needs; the ask climbs one level at a time until some manager's child promises it. A problem stops at the lowest manager whose branch holds every party, so a mistake inside a branch is settled there. Repair mirrors construction: a failed test becomes a requirement routed by the same plan that built the code. Root is just the manager at the top.

## One loop, checked at every step

<a href="docs/diagrams/the-loop.svg"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/the-loop-dark.svg">
  <img alt="The loop. Clef decides whether to split; Qwen splits and names functions; Clef checks each child's scope, dropping a child out of scope, and each child repeats the loop. A node that does not split is a worker: it asks its manager for functions, Qwen writes code, and the code must parse and export its promise. The builder renames only, under a token check, then the compiler runs the fixed test. Failures go back, dashed, to the lowest common manager and as a ticket to the owner; a manager stops after 3 rounds in a row without progress. The checks are orange." src="docs/diagrams/the-loop.svg" width="100%">
</picture></a>

Every step that produces something ends in a check (orange). Whatever fails goes back along the dashed path to the step that can fix it, and a manager stops after three rounds in a row without progress. Clef answers every yes/no gate as a probability, so each gate is a threshold with nothing to parse.

## Choices the diagrams don't show

- **One Artifacts git repo per agent, one commit per turn:** nothing to merge, nothing to conflict.
- **Prune on discovery:** below Root, a proposed child that another branch already owns is never spawned.
- **The first test stays fixed** for the whole run, so repairs can't move the goalposts, and it is bounded by the plan: the runner asserts only what the goal, the API and the promises state.
- **State lives in Durable Objects,** per room and per manager, so an interrupted turn resumes.

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

Open the `workers.dev` URL that Wrangler prints, paste the token, and press **Start**. The dashboard draws the run as a tree; select a node to see its inference path in orange. **Download app (.zip)** saves the result. [INSTALL-CLOUDFLARE.md](INSTALL-CLOUDFLARE.md) covers the Artifacts namespace, the API, exports and troubleshooting.

## Status

This is v7.15.14. **The issue tracker goal completes end to end** (run16 in 3.9 minutes, run22 in 1.9): a clean split, the entry composed from the plan, linked with no model call, and the runner's test passing in the Container after at most one repair round. A second, larger goal, a 20-rule network diagnostics engine behind one `analyze(snapshot)` method, splits, links and loads; its repair loop is the current work. Each release comes from a live run's export; every run and its fix are in [docs/how-it-works.md](docs/how-it-works.md#status).

## More

- [docs/how-it-works.md](docs/how-it-works.md): the full mechanism, the Cloudflare products, every live run, known limitations and the repository layout.
- [INSTALL-CLOUDFLARE.md](INSTALL-CLOUDFLARE.md): deploying, the API and exports.
- [CHANGELOG-v7.15.md](CHANGELOG-v7.15.md), [v7.14](CHANGELOG-v7.14.md), [v7.13](CHANGELOG-v7.13.md): what changed, with the evidence behind each change.
- [docs/history/](docs/history/): earlier changelogs and READMEs.
- [docs/diagrams/](docs/diagrams/): Excalidraw scenes (open at excalidraw.com); after an edit, export light and dark SVGs with fonts embedded.

## License

MIT, see [LICENSE](LICENSE). The vendored Acorn parser is MIT licensed, see [src/vendor/ACORN-LICENSE](src/vendor/ACORN-LICENSE). The fonts embedded in the diagrams are under the SIL Open Font License, see [docs/diagrams/fonts/](docs/diagrams/fonts/).
