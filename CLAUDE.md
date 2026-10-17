# Notes for Claude

- `docs/owner/rulings.md` holds the owner's binding design rulings. Read it before changing how agents, the runtime, or the tree work.
- `docs/owner/prompts.md` is every prompt the owner has sent, verbatim. A Stop hook in `~/.claude/settings.json` runs `scripts/owner-prompts-hook.sh` after each turn: it rebuilds the file from the session transcript and commits and pushes only that file. The hook lives in the container, so re-add it if it is missing.
- `.claude/workflows/prompt-redteam.js` is the owner's red team: three agents read `prompts.md`, hunt drift, and confirm findings and fixes by 2-of-3 quorum. Run it (Workflow with this `scriptPath`, `args: {round: N}`), fix every confirmed finding, record each in `docs/owner/drift.md` as "fixed, awaiting recheck" with its commit, and run it again until a round confirms nothing new and closes every fix.
