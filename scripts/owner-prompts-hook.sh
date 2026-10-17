#!/bin/sh
# Stop hook: rebuild docs/owner/prompts.md from the transcript, then commit and push only that file.
wt=$(cd "$(dirname "$0")/.." && pwd)
t=$(jq -r '.transcript_path')
/opt/node22/bin/node "$wt/scripts/owner-prompts.mjs" "$t" >/dev/null || exit 0
cd "$wt" && git diff --quiet -- docs/owner/prompts.md && exit 0
git commit -q -m "docs/owner/prompts.md: latest prompts" -- docs/owner/prompts.md && git push -q origin HEAD
