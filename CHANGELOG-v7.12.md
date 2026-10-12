# v7.12: fixes from the first live v7.11 runs

## What changed

Two live v7.11 runs on a real Cloudflare account stopped before Root's Container check. Run 5f85e12b paused after 80 seconds, and the larger run e89dba35 never linked at Root. v7.12 fixes what stopped them. Five fix branches were merged on top of v7.11, and a review of the merged tree led to three more commits.

The design is unchanged, with one deliberate exception. A builder may now change how an import binds its module, as well as rename. It may do this only in four forms, and only when the target's exports decide which form is right. Everything below is verified locally. No live run has used v7.12 yet.

### Artifacts: the repository decides between clone and init (F1)

**Live evidence, run 5f85e12b.**
- Worker root.3 committed `module.js` in its first turn, and its repair turn rewrote `module.js`, its only file.
- The store decided whether to clone from SQLite: it cloned only if some file row for that agent was already committed. Every row was now pending, so it ran `git init` and pushed a commit with no history onto the existing `main`.
- Artifacts rejected the push three times ("Push rejected because it was not a simple fast-forward"). root.3 paused after three failures, and the room paused at 80.6 seconds.

**Fix.**
- `CloudflareArtifactStore.writeMany` now asks the repository first, in a new `refs` phase. `git.getRemoteInfo2` reads the same receive-pack advertisement that the push reads.
- If `refs/heads/main` is listed, the store makes a shallow clone. Otherwise it runs `init`.
- A remote that returns no ref list fails the `refs` phase instead of guessing.
- The `hasCommits` flag is gone from the store API and from every caller.

**Checked.** root.3's two turns were replayed through `putFile` and `flushWrites`, using real isomorphic-git against a local git smart-HTTP server that refuses pushes that are not fast-forwards. v7.11 was rejected three times out of three with the live error. v7.12 cloned and fast-forwarded, and a later two-file turn landed on top.

### Root relinks build on the previous attempt (F2)

**Live evidence, run 5f85e12b.** Root's builder had three attempts at the entry module.
- Attempt 1 renamed `ticketService.view` to `ticketService.read`.
- Attempt 2 started again from the worker's file, so that rename was lost. It changed only the `require` path, to `./ticket-ser-f17f9f79/ticketService.js`, which resolves nowhere.
- The model wrote attempt 3's edit against the text it believed was current, and the edit was rejected with "find text is not in the file".

The import went back to the entry worker, although renames could have fixed it.

**Fix.**
- Each relink in a turn of Root's builder starts from the previous attempt's linked files. Accepted renames accumulate, and the model edits the text it was shown. The manifest still records the SHA-256 of the worker's original.
- `autoLink`, and the set of names a rename may point at, are still judged from the worker originals. A rename that an earlier attempt copied into another file does not become a known name and does not redirect an import.
- A relink can undo a rename it accepted earlier. An edit is also kept when the whole file is still a rename of the worker's original, plus the runtime's binding fixes (see F4). A partial undo is refused.
- A model path edit whose new specifier resolves to no module is rejected ("the new import path ... resolves to no module"). A bad path no longer carries into later relinks and reaches the worker as if the worker had written it.
- An edit that is sent again after an earlier attempt applied it is skipped, not reported as missing.
- A rename may never merge two variables into one name, in one edit or across relinks.
- A relink after a Container failure that changes no file is not built or run again. It relinks with the same error, or sends the failure back once relinks run out.

### Path edits mean what the model meant (F3, F6)

**Live evidence.**
- In run e89dba35, one Root attempt sent ten path edits as bare paths, such as find `../statusFilter`, replace `../implement--9b11f5c4/statusFilter`. A bare path lies inside a string token, so all ten were rejected with "find text does not match whole tokens".
- In run 5f85e12b the builder wrote `./ticket-ser-f17f9f79/ticketService.js` from a sibling folder, where `../` was needed.
- In run e89dba35 the builder wrote `./parse-filt-a1512727/combine-fi-9e51226e/combineFilters`, leaving out the nested `components/` levels.

These last two edits applied but resolved nowhere.

**Fix.**
- `applyEdits` widens a bare find to the quotes around it when it has no whole-token match and is the whole value of string literals that all sit in module specifier positions with the same quote character. The replacement is widened the same way. A value that also appears as an ordinary string is not widened, and the result still goes through the rename check.
- `normalizeEditPaths` handles a specifier in a replacement that resolves nowhere. It compares the specifier's path segments with the end of every module path, ignoring `.`, `..`, `components` and the extension. If exactly one module matches, the specifier is rewritten to the correct relative path. If none or several match, it is left alone. A specifier that already resolves, one the find text already contained, and Node built-ins are never touched.

### Import binding shape (F4)

**Live evidence, run e89dba35.**
- Builders, Root's included, proposed fixes such as `const { isStatusMatch } = require('../statusFilter')` to `const isStatusMatch = require('../statusFilter')`, where `statusFilter.js` does `module.exports = function isStatusMatch(...)`.
- Each one was rejected as adding or removing code, for example "edit adds or removes code (69 tokens before, 65 after)", and the problem went back to workers every round.
- The model also proposed the same change for `isPriorityMatch`. That module exports an object holding `isPriorityMatch`, so the change would have broken the calls.

**Fix.** The runtime now fixes the binding of a single resolved import itself, in these four forms only:

| The worker wrote | Becomes | Only when |
|---|---|---|
| `const { f } = require(p)` | `const f = require(p)` | `p`'s `module.exports` is a single function or class named `f`, nothing in `p` gives it a member `f`, and the file reads nothing off `f` except a class's static methods |
| `const f = require(p)` | `const { f } = require(p)` | `p` exports an object holding a function `f`, and the file only calls `f` |
| `import { f } from p` | `import f from p` | `p`'s only export is a default function or class named `f`, under the same conditions as the first row |
| `import f from p` | `import { f } from p` | `p` is an ES module with no default export, it exports a function `f`, and the file only calls `f` |

- Each fix is proved by tokens. Everything outside that one binding is unchanged, token for token, and the binding becomes exactly the new pattern.
- The runtime applies these fixes before the model is called and again after the model's edits, so a path the model resolves gets its binding fixed in the same link.
- A model edit that changes a binding is kept only if, apart from renames, its result is token for token the runtime's own fix. Otherwise the rejection names the binding the runtime would use. The `isPriorityMatch` proposal above is still refused.
- These cases are left for the worker: several names, defaults, rest patterns, extra exports, a differently named function, and a module that gives the export a member of that name (directly, through an alias, `Object.assign` or a computed key). So is any use of the binding as a namespace or as a value.
- `LINKER_SYSTEM` tells the model which two CommonJS forms the runtime fixes. The assembly manifest's note says a builder may change how an import binds. The `link_auto`, `link_renamed` and `link_done` events count renames and binding fixes separately.

### Name fallback (F5)

**Live evidence, run 5f85e12b.** The entry module required `./ticketService` and used `create`, `view`, `update` and `delete`, while `ticketService.js` exports `create`, `read`, `update` and `del`. No module exported every name, so `autoLink` picked nothing, although the file name matched exactly.

**Fix.**
- When no module exports every name that a file uses from an unresolved import, the module's name decides. An exact file or class name comes first, at Root and in branch builders. A looser name match follows, at Root only.
- In this fallback the module must export at least one of the names. A name read off a whole-module binding counts only if the module exports it by name or as a member.
- The link is kept only if the static name check then reports what still differs, so the file stays in the model's view.
- When several modules export every name, the one whose name matches wins, as before.

**Checked.**
- On run 5f85e12b's worker files, Root now resolves `./ticketService` with no model call and sends the model only the two member mismatches.
- With a scripted model that renames `view` and `delete`, the room test "the live 5f85e12b link resolves its path without the model" completes. The linked application loads and passes a scripted runner test in the real Container runner script, run in Node.
- A replay of the run's own three recorded model edits keeps the accepted `view` → `read` rename across both relinks. One problem goes back to the entry worker: `delete` against `del`, with the builder's renames attached.

### Fixes from the review of the merged release

A review of the five merged branches together found defects where they interact, and some older ones. Three commits fix them.

**Problems carry every builder's renames (218e3d1).**
- When relinks run out, the renames a worker hears are now compared against the worker's own publication. The runtime finds it by following `builder_sources` down through every branch builder and checks it against the recorded SHA-256. Before, Root compared only against its own input, so a rename made by a branch builder was presented as the worker's code.
- A name mismatch also lists the builder renames in the module it reads from.
- The renames ride inside each problem's detail, clipped so both fit, instead of as separate entries ahead of the problems. The 12-problem cap no longer drops a real problem to make room for a note.
- At each import whose binding changed, `linkRenames` puts the worker's binding back before it compares tokens. Before, it returned nothing whenever the token counts differed, so a binding fix hid every rename in that file. It also lists the binding change itself, for example `binding { makeStore } → makeStore`.

**A model rename that breaks an import that matched is undone (218e3d1).**
- After the model's edits, the runtime checks whether a module now reads a name that its target exported before those edits. If so, the file whose edits caused it goes back to its text from before the model. That is the target if its exported name was renamed, and otherwise the reader.
- The undone edits are reported as rejected ("it breaks an import that matched before: ..."). The caller's worker is no longer blamed when the builder renames a definition the caller uses.

**The rename check sees scope (5f98be7).**
- A variable is not renamed when the file also reads the same name where that variable is not in scope, such as a global `performance`, or an `atob` that a parameter shadows elsewhere in the file. A scope walk over the Acorn AST decides, so shadowed, hoisted, block and catch bindings can still be renamed.
- A member the file defines is not renamed when the file names it in a string or template, or reads its holder by a computed key (`handlers[op]`, `this[name]`).
- A module whose export gets members through an alias (`const api = parse; api[k] = ...`) is no longer taken for a lone function, so a destructured import of it is left alone.
- A relink can undo an accepted rename in a file that the runtime also binding-fixed. The undo is also judged against the worker's original plus the runtime's own binding fix.

**Root asks for the entry instead of guessing (7c5fe8f).**
- Live evidence, run e89dba35: no module exported `start()`, and on the third attempt of one Root link the model named no usable entry. v7.11 then took the module that imports the most others and is imported by none. That was `combineFilters.js`, a filter combinator.
- With no module exporting `start()` and no proposal from the model, there is now no entry. Root calls the model even when every import resolves, and the linker prompt lets the model name the entry from any listed module, not only the files it was sent in full.
- The "No application entry" problem goes first to a module whose file name marks it as the application (`app.js`, `main-app.js`, `issueTrackerApp.js`), nearest Root first. Only if there is none does it go to the module that imports the most others.

**An exact name blocks a lone provider (7c5fe8f).** In a local replay of run e89dba35's Root inputs, v7.11's `autoLink` pointed `ticket.js`'s `./ticketStore` at `issueTrackerApp.js`, the only module exporting `createTicket`, although `ticketStore.js` matches the path exactly. Now, when another module is named exactly like the path, the only provider is not picked, and the model decides.

### Replay of run e89dba35 at Root

These are Root's inputs at step 101 of run e89dba35, replayed locally with a model that proposes no edits:

| | v7.11 | v7.12 |
|---|---|---|
| Fixed without the model | 4 import paths, one of them to the wrong module | 6 import paths and 5 bindings |
| Modules sent to the model in full | 5 | 3 |
| Problems sent back | 8, to 5 workers | 5, to 3 workers |

- Live, this link sent 6 modules in full and 12 problems, which is the cap.
- Replaying the live model's own edits instead gives 9 problems to 5 workers on v7.11, and 5 problems to 3 workers on v7.12.
- v7.11 also sends path and binding problems to the filter workers (root.3.4.5, root.3.4.1.3) and to root.4.2. v7.12 fixes those itself.
- The five problems left on v7.12 need worker changes:
  - `ticket.js` destructures `createTicket`, but `ticketStore.js` exports `saveTicket`.
  - `deleteTicket.js` uses `getTickets` and `updateTickets`, but the data model exports `getTicket` and `updateTicket`.
  - `issueTrackerApp.js` imports `./createTicket` and `./viewTickets`, which no module provides.
  - No module exports `start()`.

### Documentation and tooling

- `README.md` is rewritten for judges, and `INSTALL-CLOUDFLARE.md` is a guide to a fresh deploy on your own account.
- The earlier README, install guide and changelogs moved to `docs/history/`.
- `npm run check` (`scripts/check.mjs`) syntax-checks every `.js`, `.mjs` and `.cjs` file in `src/`, `public/`, `container/` and `test/`.
- CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run check` and `npm test` on Node 22.
- `package-lock.json` pins Wrangler 4.149.0 and isomorphic-git 1.44.1.
- `package.json` requires Node 22.13 or newer.

## Container image

`container/` is unchanged since v7.11.

## Tests

229 local tests pass (`npm test`), up from 184 in v7.11. The new tests are:

- `test/artifact-store.test.js` (4 tests): an empty repository is initialized and never cloned, and a repository with `main` is cloned and never initialized. Ref discovery is checked against the real isomorphic-git parser for three advertisements. Each failure names its phase and never exposes the write token.
- `test/integration.test.js` (2 tests): the fake Artifacts store now rejects a push with no history onto a non-empty repository, as the live run did. A turn that rewrites every file it owns commits on top of the history, and a push that landed but lost its response is committed on top on replay.
- `test/edit-paths.test.js` (5 tests): bare and sibling path edits from the live runs, the negative cases, and a room test that applies the live edits.
- `test/v711-builder.test.js` (34 tests): relinks that accumulate, undo and reject unresolvable paths; binding fixes in all four forms and the cases they must refuse; the name fallback; the scope, string-key and alias guards; the renames workers hear and the 12-problem cap; undoing a rename that breaks an import; and entry choice. Several room tests use the sources of runs 5f85e12b and e89dba35 with the real Container runner script.

Six existing tests that encoded the old behavior were updated. They covered the separate rename note, the entry fallback to the biggest importer, and a provider winning over an exact name. Two more tests were adjusted when the F2 and F4/F5 branches were merged (c78df0f), so that each still exercises what it was written for. Each of the 12 tests added by the review commits fails when `src/` is put back to the merged tree before those commits.

Live Cloudflare deployment of v7.12 is not verified.

## Still open

- The rename check compares tokens, not line breaks. An edit that only adds or moves a line break, such as splitting `return m.value` after `return`, is accepted and can change behavior through automatic semicolon insertion.
- A model path edit that points an import at the wrong module is kept if the path resolves. In the e89dba35 replay, the model pointed `issueTrackerApp.js`'s `./createTicket` at `ticketModel.js`, and the entry module's worker then heard a mismatch against the builder's pick. A branch builder can likewise pick the wrong module inside its branch, and Root does not re-examine an import that already resolves unless the static name check or a runtime error points at it.
- The runtime undoes a rename that breaks an import only when the static name check can see the break. A member read off a value that a factory returns is not visible to that check. The undo also restores the whole file, so a good rename in it must be proposed again on the next relink.
- Member mismatches such as `delete` against `del` still need a model rename. The runtime has no deterministic member rename.
- The splitter asks one Root child to own the entry, but the runtime does not record which child. The "No application entry" problem goes to a module chosen by its file name.
- A module named in the previous error is sent to the model in full, even when it is only the provider, as `ticketService.js` was in the 5f85e12b replay.
- Model prompts outside the linker still describe the builder as rename-only: the worker repair message, the splitter prompt and the worker dependency rule. Workers should code to that rule, because binding fixes are applied before any problem is routed. Still, the wording is narrower than what the runtime does.
- Linker input at one level is not split when it exceeds the model's context.
- `MOCK_AI=true` still uses the older builder path.
