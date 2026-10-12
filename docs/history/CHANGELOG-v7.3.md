# v7.3 — Independent Leaf Dependencies

## Fixes

- Applied a shared dependency rule to **both** Qwen leaf-generation paths (inline files from `decide` and targeted `generateFile`): use Node built-ins/browser-native APIs; do not import npm packages or guess sibling source paths; obtain external collaborators via function/constructor parameters. This does not affect Clef routing, Qwen decomposition, or builder linking.
- Removed the contradictory prompt instruction to guess an external file import. Workers can assume an external function **signature**, not an external file location.
- Added `sourceDependencyError` at leaf publication: reject third-party imports and unresolved relative imports, while allowing imports of files authored by the **same** leaf, including multi-file responses. Errors are corrected in the existing bounded two-attempt loop before being written to Artifacts.
- Updated builder prompts to avoid invented npm dependencies when linking standard-library/browser-native leaf code.
- Updated deterministic mock fixtures to generate native `node:http` routing and a package manifest **without Express**. The mock API accepts storage callbacks from the builder; the mock test is now actual executable JavaScript rather than prose.
- Extended the deterministic public interface reader to recognize `req.url` + `req.method` patterns in native Node HTTP handlers (previously only Express/router patterns), keeping old routing tests functional.

## Verification

`npm test`: **163 tests passing** (157 existing + 6 new regression tests). `npm run check` succeeds.

## Scope and limits

- This fixes avoidable dependency and guessed-path failures for **newly generated source**. It does not automatically rewrite existing Artifacts repositories or guarantee correctness of generated applications.
- The source gate checks literal `import`/`require` references, not arbitrary dynamically constructed module names. Runtime build verification still checks actual execution.
- Existing Cloudflare Worker name, DO bindings, and Artifacts namespace are unchanged. Live deployment has not been performed.
