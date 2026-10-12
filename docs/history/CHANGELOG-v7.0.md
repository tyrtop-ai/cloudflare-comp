# v7.0 — Code-first recursive inference

The unit of delegated work is **code**, not a plan or abstract design assignment.

## Execution roles

1. Clef classifies whether the requested code can be divided into independently authored smaller code modules. If no, the code is authored in the same worker turn.
2. Qwen is invoked for an admitted split. It proposes 2–3 source-code modules, including module filenames, exported signatures, and specific implementation work when available. Only the code assignment—not planning work—is passed to each child.
3. Once it has delegated, the parent is a deterministic/Clef-assisted router. It cannot write source, link modules, or perform generative planning.
4. Qwen leaf workers implement the assigned code. They may produce multiple source files but cannot substitute documentation or summaries for code.
5. A separate temporary builder materializes the original leaf source byte-for-byte and writes only package/entrypoint/adapter glue. The root's final assembly is checked by the Container runtime; genuine source failures route to their owners.

## Enforced changes

- Newly split production child tasks are normalized into explicit instructions to **write executable source code**, optionally naming a required module and its exports. No child is created to write a planning document.
- Production leaves cannot publish README/Markdown, plaintext descriptions, or reserved memory paths as their implementation deliverable.
- A leaf cannot claim completion without published code. When the splitter specified a required module filename, the leaf must publish that specific source file. This check is mechanical; it is not a proof the code fulfills its functional requirements.
- Qwen may now return full source bytes as `files[].content` in the **same inference as the code action**, eliminating one separate model call per file. The files are preserved in Durable Object replay before Artifacts writes. The old `files[].intent` protocol remains supported for previously queued turns and mock fixtures.
- Builder Qwen may similarly return up to four actual glue/config files inline rather than choosing paths and then generating each in a separate turn. Existing candidate validation and correction loops still apply.
- Invalid inline worker source gets one targeted follow-up file-generation attempt. It is not accepted as completed code.
- Existing manager routing, repository isolation, Clef scope admission, private ownership tree, builder source preservation, context-limited delegated builders, executable build verification, and provenance-based repair remain in place.

## Tests and limits

Run `npm test && npm run check`. New tests cover actual Qwen-to-worker source contracts, filename enforcement, README rejection, inline source writing, inline-source correction, and builder one-shot output protocol. The v6.9 integration and Container tests remain.

This is not an end-to-end live Cloudflare performance measurement. The production build must still be verified after deployment. This release does **not** prove that independently generated source is functionally complete: the Container build/import checks and application-level functional tests remain necessary.
