# Exact document cleanup for the supplied repository

Version 2.0 | Based on `PayGuard_Repository_Tree.md`, generated 2026-09-14. Verify actual paths and contents before changing them.

## The direct answer

**Remove two files from their active locations, but archive their contents first:** `docs/CLAUDE.md` and `docs/PAYGUARD_BUILD_PROMPTS.md`. Install the new `CLAUDE.md` at root. No unique engineering history, checkpoints, evidence or migrations need permanent deletion.

Do not keep an old file named `CLAUDE.md` anywhere inside an archive. Rename it to `CLAUDE.legacy.md` so it is a historical document rather than an instruction-file discovery target. The official Claude Code memory documentation explains that nested instruction files can load when their directories are read; conflicting rules do not reliably cancel one another [A2 in PAYGUARD_PACK_SOURCES.md].

## Exact action table

| Existing path from your tree | Action | Why / replacement |
|---|---|---|
| `docs/CLAUDE.md` | Archive to `docs/archive/pre-mvp-v2/CLAUDE.legacy.md`, then remove the old active path | Old scope says no UI, subsidy required, Aqua unselected. New root `CLAUDE.md` replaces it. |
| Root `CLAUDE.md`, if it already exists despite the tree | Preserve old content as `docs/archive/pre-mvp-v2/ROOT_CLAUDE.legacy.md`, then merge legitimate unrelated rules into new root file | Do not blindly discard local rules or preserve superseded scope. |
| `docs/PAYGUARD_BUILD_PROMPTS.md` | Archive to `docs/archive/pre-mvp-v2/PAYGUARD_BUILD_PROMPTS.v1.md`, then remove the old active path | Stages 1-5 are completed; do not rerun old Stage 6/7 scope. Replaced by B/F/R prompts. |
| `docs/01_CLAIMS_EXTRACTED.md` | KEEP, reference-only | History of claims, not current build instructions. |
| `docs/02_VERIFICATION_RESULTS.md` | KEEP, reference-only | Useful corrections/evidence. Not a new backlog. |
| `docs/PAYGUARD_VERIFIED_REVIEW.md` | KEEP, reference-only | Research and provenance; proposed code was not executed during that review. |
| `docs/03_REBUILT_ARCHITECTURE.md` | KEEP | Supporting architecture. Add a short scope-precedence note; do not erase original technical detail. |
| `docs/API_CONTRACT.md` | KEEP and update narrowly with implementation/tests | Existing wire specification; old paths/types must not be replaced from memory. |
| `docs/STAGE5_FRONTEND_BACKEND_INTEGRATION_AUDIT.md` | KEEP unchanged as a dated audit | Resolve findings in new checkpoints; do not rewrite the audit to say defects never existed. |
| `docs/implementation/BUILD_SCOPE.md` | KEEP, revise current selection explicitly in B0 | Aqua becomes required; subsidy becomes optional. Preserve old decision history. |
| `docs/implementation/STATE.md` | KEEP, update in place | Do not replace real progress with a template from this ZIP. |
| `docs/implementation/DECISIONS.md` | KEEP, append decisions | Record scope, interface, reset and branch decisions without overwriting history. |
| `docs/implementation/DEPENDENCIES.md` | KEEP, update only verified changes | Current pinned installed graph takes precedence over old candidate version suggestions. |
| `docs/implementation/SOURCE_MAP.md`, `SOURCES.md`, `TRACEABILITY.md` | KEEP, update in place | Record current versus historical source roles and new test mappings. |
| `docs/implementation/checkpoints/01.md` through `05.md` | KEEP unchanged | New work uses B/F/R IDs; no recycled PASS claims. |
| Entire `docs/implementation/evidence/` tree | KEEP | Old outputs/ABIs/vectors are evidence. New runs use new paths. Regenerate only intended current generated artifacts with traceable provenance. |
| Root `DATABASE_SCHEMA.sql` | KEEP as historical proposal, do not execute as an upgrade | Executable schema history is `packages/db/migrations/0001...0005` and subsequent forward migrations. Check script references before any future move. |
| `reference/CONTRACT_INTERFACE.sol` | KEEP as historical/proposed reference | Actual implementation/interfaces and generated artifacts are current. Do not overwrite compiled interfaces with the proposal. |
| `contracts/core-v4/README.md` and package READMEs | KEEP and adjust command/scope references where needed | They describe actual local code. |
| Existing earlier `PAYGUARD_FINAL_HACKATHON_MVP.md` or sponsor notes | Preserve the previous revision if different, then replace with the pack's version at `docs/` | Same product scope; this pack makes backend-first scheduling explicit. |

The three long research files can be moved later if the team wants a smaller active docs listing, but that is **not required**. Moving them now can break source links or scripts. Marking them reference-only solves context overload without losing provenance.

## Do not delete these to clean up documentation

- `apps/`, `packages/`, `contracts/`, `.gitmodules`, installed vendor pins or root workspace/lock files.
- `packages/db/migrations/`, actual database volumes or chain state.
- Existing stage evidence, signatures/vectors, branch history or AI/spec attribution material.
- The colleague's frontend, styles/assets, `main` branch or any unreviewed untracked file.

The tree intentionally excludes builds, caches and other generated paths. Their absence is not proof they do not exist. This pack is not a permission to clean those directories.

## Safe migration procedure for B0

1. Inspect Git status including staged/untracked files, applicable CLAUDE/AGENTS/local rules, file digests and references to the two retiring files. Do not print private configuration contents.
2. Create the archive directory only if needed. If an archive destination already exists, compare contents and preserve a unique version instead of overwriting it.
3. Preserve old instruction/prompt bytes, then remove only the inspected original active paths. Tracked files may use a deliberate Git move; untracked files require an explicit filesystem copy/move after inspection.
4. Ensure old CLAUDE content has a non-instruction filename. Add an archive README describing supersession, without editing the archived source bytes.
5. Install/merge root CLAUDE.md and overlay new docs. Do not replace `docs/implementation` or API_CONTRACT with empty templates.
6. Update active links in root/package docs, scripts and SOURCE_MAP as necessary. Do not rewrite historical source quotations; a source-map redirect is enough for historical citations.
7. Check for accidental removal and broken active references. Record every changed/moved file, hashes and rationale in checkpoint B0.
8. Start a fresh agent session for B1 so an already-loaded obsolete no-UI instruction does not linger in conversation context.

Do not use `rm -rf docs`, `rm docs/*.md`, `git clean`, or a blanket restoration from main.

## Optional permanent deletion

Only byte-identical duplicate copies may be permanently deleted after confirming one preserved copy, no active references and no unique local edits. A title such as "copy" or "old" is not evidence of duplication. The default recommendation is archival, not deletion.

## Suggested precedence note for retained architecture

```text
Current scope: docs/PAYGUARD_FINAL_HACKATHON_MVP.md and the selected B/F/R prompt.
This file remains supporting design. Historical choices that defer Aqua or require
merchant subsidy are superseded by the two-independent-route MVP. API/ABI/schema
changes still require explicit implementation decisions and tests.
```

For files already inside `docs/`, use a relative link without duplicating `docs/docs/`. These are wording examples, not a requirement to modify historical audit content.
