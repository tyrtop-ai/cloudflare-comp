# Drift ledger

Findings from the prompt red team (`.claude/workflows/prompt-redteam.js`): three agents read `prompts.md`, hunt places where the code doesn't follow the owner, and confirm findings and fixes by 2-of-3 quorum. Claude fixes each confirmed finding, marks it "fixed, awaiting recheck" with the commit, and runs the red team again. An item is closed only when the quorum confirms the fix. The loop ends when a round confirms nothing new and closes every claimed fix.

## Open

(none yet)

## Fixed, awaiting recheck

(none yet)

## Closed (fix confirmed by quorum)

(none yet)

## Rejected by quorum

(none yet)
