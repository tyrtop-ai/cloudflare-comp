# v7.5 — Evidence-based split recovery

## Why this release

In a live issue-tracker run, Clef voted **YES** on decomposition at p=0.56, Qwen proposed four shell/command-parsing children, and Clef's root/parent scope gate admitted only one. The single remaining child was not a valid implementation partition. v7.4 repeated this same routing cycle without providing the rejected children's details to the models, and paused after three unsuccessful attempts.

## Corrected flow

1. A Clef YES authorizes **an attempt** to split; it does not guarantee Qwen produced a valid partition.
2. If scope admission leaves fewer than two code-writing children, do not spawn a partial tree. Persist a structured rejection describing the accepted children, rejected children (including Clef probabilities), and original scope.
3. On the **next** routing turn, Clef receives the assigned code plus that rejected-partition evidence. Clef can choose **NO**, in which case Qwen implements the local assigned code in the same turn. No automatic forced implementation is performed by the runtime.
4. If Clef still chooses **YES**, Qwen receives the rejection details and original goal as a **scope boundary only** so that it can propose a corrected, non-overlapping split rather than repeating unrelated work.
5. As soon as Clef routes to implementation, the previous split evidence and original global scope are removed from the leaf implementation context; leaf implementation is still independent.
6. An irreparably bad decomposition can still pause after the existing retry budget; retries are now informed rather than blind. No threshold, fixed fanout, or forced implementation fallback was added.

## Tests

- Reproduction: p=0.56 YES, four children, three scope rejections, one accepted child; subsequent Clef NO leads to a Qwen-written code file, without a repeated split.
- Alternate flow: Clef still votes YES after seeing the failed partition; Qwen sees the structured feedback and proposes a corrected two-child split that is admitted.
- Existing v7.4 tests remain unchanged and passing; **167/167** local tests and syntax checks passed.

## Deployment

This is the same Cloudflare Worker and bindings as v7.4. Use `INSTALL-CLOUDFLARE.md`. New rooms exercise the updated retry/routing behavior; v7.5 also reads persisted split feedback across worker restarts when a room has been running the new code. Remote end-to-end inference and Container verification have **not** been performed.
