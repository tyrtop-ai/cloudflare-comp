# v7.1 — Split code tasks, not filenames or interfaces

## Scope of this patch

Qwen's splitter now emits descriptions of the smaller **code to write**, without creating mandatory file paths, module names, or exported function signatures.

- `src/model.js`: the splitter prompt explicitly forbids inventing child file paths and export signatures; children are code-writing assignments only.
- `src/protocol.js`: `normalizeAction().spawn` deliberately discards legacy `module` and `exports` metadata so those values cannot become child contracts.
- `src/index.js`: production child tasks are derived from their assigned implementation work, without turning splitter-proposed module/export metadata into mandatory constraints.
- `src/code-work.js`: no synthetic file or public export requirements are appended. Existing **explicit** file constraints in the parent's actual task remain preserved. Fixed parsing of explicitly specified source paths ending in a sentence period.
- `test/code-first.test.js`: regression coverage verifies filename/interface metadata is ignored, child tasks carry code-writing work only, and leaf workers can choose the source filename.

## Important: intentionally not changed

This patch does **not** redesign the other architectural constraints found in the audit: the Root-goal Clef admission test for every split, fixed 2–3-child decomposition, forced leaf implementation after failed splits/capacity limits, provisional builder runs, per-turn file limits, and code-publication-only leaf completion criteria. Those require explicit decisions about the intended algorithm, so this release does not silently change them.

Run `npm test && npm run check`. The tests are local, not a proof of live Cloudflare deployment or end-to-end application correctness.
