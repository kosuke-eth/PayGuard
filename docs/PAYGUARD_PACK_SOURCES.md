# PayGuard v2 pack: sources, boundaries and provenance

Prepared: 2026-09-14. This is a continuation prompt/documentation kit, not a new code audit or a completed implementation.

## User-provided basis

1. `PayGuard_Repository_Tree.md`, generated from the user's PayGuard workspace on September 14. Copied into this pack unchanged. It establishes the reported paths and excluded directories; it does not establish file contents, current Git status or test success.
2. `STAGE5_FRONTEND_BACKEND_INTEGRATION_AUDIT.md`, read in the conversation. It reports the existing Stage-5 functionality, incomplete responses/readiness, SPEC-037, an incompatible frontend simulator and a reusable public package. These are reported audit findings, not independently rerun tests in this session.
3. Previous `PAYGUARD_FINAL_HACKATHON_MVP.md`, read in full. Product scope is preserved: independent v4 and Aqua/SwapVM routes, real owner UI, direct reference and optional subsidy. The v2 plan explicitly adjusts execution order for the user's backend-first/frontend-later request.
4. Previous `SPONSOR_VERIFICATION_2026-09-14.md`, read in full and included unchanged as a dated evidence snapshot. Current additional retrieval is distinguished below.
5. Previous `PAYGUARD_BUILD_PROMPTS.md` shared scope/workflow and initial stages, and previous CLAUDE.md in full, inspected to identify conflicting no-UI/mandatory-subsidy/optional-Aqua instructions. The historical files are to be archived, not blindly continued.
6. Existing architecture, API and SQL/interface excerpts supplied in the conversation. They are references; this kit intentionally does not replace the current executable code, migrations or published API file with older proposals.

No local GitHub workspace, live database or deployed contract was inspected for this packaging task. The mounted files are source documents and generated artifacts, not the user's repository. B0 and later prompts require the coding agent to inspect the real checkout before acting.

## Current source retrieval for the workflow

### A1. Claude Code best practices

https://code.claude.com/docs/en/best-practices

Retrieved with web and Context7 (`/websites/code_claude`). Supports concise project instructions, targeted context, explicit verification criteria and bounded investigation/review. The specific B/F/R stages and PayGuard acceptance tests are newly authored workflow decisions, not prescribed by this page.

### A2. Claude Code memory and instruction scope

https://code.claude.com/docs/en/memory

Retrieved with web and Context7. Supports keeping startup instructions concise, understanding imports as context loading, and resolving nested instruction conflicts. This informed removal of old `docs/CLAUDE.md` as an active instruction source and avoiding an archive file named exactly CLAUDE.md. The archive naming convention is this pack's choice.

### A3. Git worktree

https://git-scm.com/docs/git-worktree

Retrieved with web. Supports isolated checkout/worktree inspection, including detached worktrees. A worktree does not automatically copy dirty/untracked backend changes; F0 explicitly requires preserving the actual baseline rather than assuming HEAD contains it.

### A4. Git fetch and show

https://git-scm.com/docs/git-fetch
https://git-scm.com/docs/git-show

Retrieved with web. Supports fetching refs and inspecting objects without a wholesale branch merge. The chosen selective frontend import and provenance map are project-specific safety decisions.

### A5. Git restore

https://git-scm.com/docs/git-restore

Retrieved with web search. Restore can replace or remove selected paths according to the source tree. The pack therefore does not prescribe restoring the entire root from main; import paths must be inspected for collisions.

## Current source retrieval for sponsor boundaries

### S1. 1inch Tokyo 2026 task

https://ethglobal.com/events/tokyo2026/prizes/1inch

Fresh Firecrawl scrape with maxAge=0 succeeded. The retrieved page calls for an Aqua application, official contract use, on-chain token transfers in the demo and proper Git history; it permits local forks and opcode modification, and favors SwapVM use. It does not make a new custom opcode compulsory. Regular and Continuity offerings are distinct. This is not confirmation of the team's eligibility or judging outcome.

### S2. Uniswap Tokyo 2026 task

https://ethglobal.com/events/tokyo2026/prizes/uniswap-foundation

Fresh Firecrawl scrape with maxAge=0 succeeded. The retrieved task covers Uniswap stack integrations, not only hooks. It requires public code, FEEDBACK.md/developer feedback submission and useful README code pointers. The required MVP therefore need not include merchant LP subsidy. Competitive originality and the user's permitted event track remain separate questions.

### S3. Event details

https://ethglobal.com/events/tokyo2026/info/details

Retrieved with web in this session. The inherited dated sponsor notes contain the detailed rule interpretation. R1 rechecks current requirements and records prior work/AI/spec provenance. The kit does not delete evidence to make an existing project look new and does not claim registration approval.

## Protocol source boundary

The official Uniswap callback/delta guide was retrieved in this session:

https://developers.uniswap.org/docs/protocols/v4/guides/unlock-callback-and-deltas

It supports the requirement to complete currency accounting inside the unlocked operation. Detailed B3 implementation behavior must be confirmed against the user's actual installed revision and tested.

A web open of the earlier SwapVM v1.0.2 GitHub source returned an internal retrieval error in this session. No new successful fetch is claimed. Earlier source references remain historical evidence; B4 is explicitly required to retrieve the current selected official source/SDK graph and execute it. A source URL or tag in an older review is not a substitute for that verification.

## Deliberate new decisions in this pack

- B0-B5 backend first, F0-F3 frontend later, R1 combined release. Parallel F0-F2 after B2 is optional and explicitly coordinated.
- Keep existing current schema/API/implementation state rather than replacing it with an old reference snapshot.
- Archive exactly the two conflicting active instruction/prompt files by default; keep research history and stage evidence.
- Permit isolated protocol implementation before browser work, but do not mark browser readiness passed until actual frontend tests.
- Add only a bounded local demo bridge/session recovery read if the real code lacks the necessary interface. These are marked proposals, not existing endpoints.
- Separate real browser application tests, intended wallet-extension tests, protocol execution and organizer eligibility.

## Pack validation boundary

The pack is checked for Markdown fence consistency, required prompt IDs, relative links to included files, root/docs placement, and archive integrity. It contains Markdown instructions and plans only. No application tests, migrations, protocol deployments, browser sessions or branch operations are performed by this kit-generation task.

Existing paths outside this ZIP (for example API_CONTRACT.md and docs/implementation/STATE.md) are intentionally retained in the user's checkout. Do not delete them because they are absent from the ZIP.

## Input checksums

These identify mounted source-document bytes, not the implementation code:

| Source | SHA-256 |
|---|---|
| PayGuard_Repository_Tree.md | `df028f838dc55eea3d21a04790314f5945f491be0ec46f72e6e1b9b96c7ee476` |
| STAGE5_FRONTEND_BACKEND_INTEGRATION_AUDIT.md | `d319461c0b7208c5106f43c2d63c8b52ab879e537c841a821c987c746339ab3a` |
| Previous final MVP plan | `f711ce985c62b6084b002c9a268f45f0cfb609b09ed1e1e471b8dc58ff24b68b` |
| Previous build prompts | `3d909ec20033c04688ab9c399a5ff64f3a9482eba2a29d4268772eab3afd3677` |
| Previous root instructions | `889283050c1fdfe066aa63d9b17ca07b5714ad54e19c93aaffb24a9ddb6361b7` |
