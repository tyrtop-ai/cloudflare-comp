# Notes for Claude

- `docs/owner/rulings.md` holds the owner's binding design rulings. Read it before changing how agents, the runtime, or the tree work.
- `docs/owner/prompts.md` is every prompt the owner has sent, verbatim. A Stop hook in `~/.claude/settings.json` rebuilds it from the session transcript after each turn (`node scripts/owner-prompts.mjs <transcript.jsonl>`). That hook lives in the container, so re-add it if it is missing. Commit the file with each push.
