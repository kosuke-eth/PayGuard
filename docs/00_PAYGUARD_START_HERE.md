# PayGuard MVP continuation pack: start here

Version 2.0 | 2026-09-14 | Backend-first continuation after Stage 5, frontend reuse later.

## Install without losing your existing work

Copy the ZIP's `CLAUDE.md` to the repository root. Overlay the ZIP's `docs/` contents into the existing `docs/` folder. **Do not replace/delete the entire docs folder.** This pack intentionally does not contain replacement migrations, implementation state, API specifications, checkpoint history or old test evidence.

The supplied tree shows `docs/CLAUDE.md` but no root CLAUDE.md. Inspect the actual repository: keep any legitimate unrelated root rules, preserve the old PayGuard instructions under a non-instruction filename, and use the updated root file. See [the exact cleanup guide](PAYGUARD_DOCS_CLEANUP.md).

No cleanup is performed by extracting the ZIP. B0 performs the inspected document migration and preserves history. Start a fresh coding-agent session after removing stale instruction sources.

## Product and scope

Read [the final plan](PAYGUARD_FINAL_HACKATHON_MVP.md).

The required end state is a usable owner console with real signed agent payments and **two separate routes: Uniswap v4 and Aqua/SwapVM**. Direct payment remains a reference/fallback. Merchant subsidy is optional, not a prerequisite. The old Stage 6 prompt that mandates subsidy and excludes Aqua is superseded.

We are continuing `apps/api`, `apps/worker`, the current PostgreSQL migrations, `PayGuardVault`, and the existing integration package. Do not regenerate the backend from the original architecture proposal.

## What to run now

Open [PAYGUARD_BACKEND_PROMPTS.md](PAYGUARD_BACKEND_PROMPTS.md). Paste the complete fenced **B0** prompt into your coding agent. Run exactly one prompt per task/session, let it implement and review, then read its checkpoint before providing the next prompt.

| ID | Outcome | Prerequisite |
|---|---|---|
| B0 | Preserve actual Stage-5 baseline, retire conflicting instructions, reconcile scope and commands | Existing repository and this pack |
| B1 | Repair browser-facing read/config/auth contract, deployment readiness and known worker recovery defect | B0 PASS |
| B2 | Bounded demo actors, repeatable local setup, actual API-driven direct scenarios and a documented browser handoff | B1 PASS |
| B3 | Real normal-fee Uniswap v4 adapter through the existing payment pipeline | B2 PASS |
| B4 | Independent official Aqua/SwapVM strategy and payment adapter | B3 PASS in the default serial workflow |
| B5 | Combined backend acceptance, exports and handoff for frontend work | B1-B4 PASS |

The backend-only workflow is allowed to prove protocol routes before UI work begins. It must leave browser readiness explicitly unverified. This is an ordering adjustment to the earlier browser-first recommendation, not permission to release without a real frontend.

## What to run later

Use [PAYGUARD_FRONTEND_PROMPTS.md](PAYGUARD_FRONTEND_PROMPTS.md). These prompts **fetch and reuse the colleague's frontend from main**, not start from scratch.

| ID | Outcome | Prerequisite |
|---|---|---|
| F0 | Pin fresh main, inspect in a detached worktree, import reusable presentation into a safe backend-based integration branch | B5 PASS by default; B2 PASS permits an explicitly selected parallel workflow |
| F1 | Real browser login, shared package, one direct payment and exact exception approval | F0 PASS and B2 PASS |
| F2 | Owner dashboard, funding, policy create/replace/revoke, approval queue and accurate receipts | F1 PASS |
| F3 | Real demo workspace, activity/reload handling, both protocol routes, visual and browser acceptance | F2 PASS and B5 PASS |
| R1 | Combined release rehearsal, evidence, source history and sponsor-readiness report | B5 and F3 PASS on the combined tree |

A colleague may do F0-F2 alongside B3-B4 after B2 if the team explicitly chooses that workflow. Coordinate ownership of `packages/integration`, root manifests, locks, generated ABIs, configuration and migrations. Nothing in this pack automatically merges or pushes either lane.

Run [the R1 prompt](PAYGUARD_RELEASE_PROMPT.md) last. No mandatory subsidy prompt is included. Adding subsidy requires a new selected task after both required routes and frontend pass.

## File map

| File | Role |
|---|---|
| `../CLAUDE.md` | Concise persistent repository rules |
| `PAYGUARD_FINAL_HACKATHON_MVP.md` | Current product scope and sponsor choices |
| `PAYGUARD_DOCS_CLEANUP.md` | Exact keep/archive/remove plan for your supplied tree |
| `PAYGUARD_AGENT_WORKFLOW.md` | Shared context, tools, reviews, gates and change safety |
| `PAYGUARD_BACKEND_PROMPTS.md` | Six continuation prompts B0-B5 |
| `PAYGUARD_FRONTEND_PROMPTS.md` | Four frontend reuse/integration prompts F0-F3 |
| `PAYGUARD_INTEGRATION_BOUNDARY.md` | Focused integration decisions and explicitly proposed demo bridge |
| `PAYGUARD_FRONTEND_SCOPE.md` | UI behaviors, freedom and truthful display semantics |
| `PAYGUARD_ACCEPTANCE_AND_DEMO.md` | Required evidence and concrete product/sponsor scenarios |
| `PAYGUARD_RELEASE_PROMPT.md` | Final R1 review and rehearsal prompt |
| `PAYGUARD_PACK_SOURCES.md` | What was read, what was researched, limitations and pack integrity |
| `SPONSOR_VERIFICATION_2026-09-14.md` | Dated requirements snapshot; not organizer approval |
| `PayGuard_Repository_Tree.md` | Supplied historical tree, not a current filesystem guarantee |

## Existing files to keep using

Keep `docs/API_CONTRACT.md`, `docs/03_REBUILT_ARCHITECTURE.md`, the integration audit and all of `docs/implementation/`. Keep `reference/CONTRACT_INTERFACE.sol` as a proposal reference, actual Solidity interfaces under `contracts/core-v4/src/interfaces/`, and real migrations under `packages/db/migrations/`.

Update API_CONTRACT and implementation decisions only when code/tests establish a correction. This pack does not falsely publish an updated ABI or pretend the audited missing responses are already fixed.

## Gate naming

Old stages `01` to `05` remain historical evidence. New checkpoints use `B0.md` through `B5.md`, `F0.md` through `F3.md`, and `R1.md` under the existing checkpoint directory. Existing command names are discovered at B0. Proposed new commands are implemented and tested before being used as gates; their names in a prompt do not mean they already exist.

## Start instruction for a fresh chat

Paste a complete selected prompt, or use:

```text
Read root CLAUDE.md and docs/00_PAYGUARD_START_HERE.md. Execute only prompt B0 from docs/PAYGUARD_BACKEND_PROMPTS.md, including its shared workflow, tests, review and checkpoint. Preserve the existing Stage 1-5 implementation. Stop after B0.
```

For later tasks replace the ID and prompt filename. Do not instruct the agent to execute every prompt unattended.
