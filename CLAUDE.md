# Notes for Claude

- `docs/owner/rulings.md` holds the owner's binding design rulings. Read it before changing how agents, the runtime, or the tree work.
- `docs/owner/prompts.md` is every prompt the owner has sent, verbatim. A Stop hook in `~/.claude/settings.json` runs `scripts/owner-prompts-hook.sh` after each turn: it rebuilds the file from the session transcript and commits and pushes only that file. The hook lives in the container, so re-add it if it is missing.
