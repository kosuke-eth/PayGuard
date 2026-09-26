# PayGuard source map

Established at Stage 1. Logical name -> actual path, plus precedence/correspondence notes.

| Logical name | Actual path | Notes |
|---|---|---|
| REVIEW | `PAYGUARD_VERIFIED_REVIEW.md` (3465 lines) | Sections: 1 Claims (L15-730), 2 Verification (L731-2098), 3 Architecture (L2099-2583, identical content to standalone ARCH file), 4 Open questions (L2584-2611), 5 Verdict (L2612-2638), source register (L2639+). |
| ARCH | `03_REBUILT_ARCHITECTURE.md` (555 lines) | Standalone copy of REVIEW Section 3. Read in full. Authoritative design source for Stage 1-7. |
| API | `API_CONTRACT.md` (261 lines) | Read in full. Authoritative wire contract. |
| DB | `DATABASE_SCHEMA.sql` (358 lines) | Read in full. Proposed P0 schema, not yet executed (per its own header comment and O13). |
| INTERFACE | `reference/CONTRACT_INTERFACE.sol` (160 lines) | Present (not missing). Read in full. Proposed interface only, not compiled/deployed — its own header says so. `pragma solidity 0.8.26`. |
| VERIFICATION | `02_VERIFICATION_RESULTS.md` (1449 lines) = REVIEW Section 2 | 227 entries C001-C227: 107 confirmed, 103 partially correct, 10 incorrect, 7 unverifiable (per REVIEW L2610 ledger line, confirmed present at file tail as summary line preceding Section 3 in REVIEW but absent from the standalone verification file's own tail — standalone file ends at C227 without the summary line, which lives in REVIEW only). Spot-read entries C099-C105 (Uniswap v4 hook/fee/callback mechanics) directly relevant to Stage 1's Anvil fixture. Full 227-entry register not read line-by-line in this session; ARCH already synthesizes the corrections (mixed-unit invariant, relayer/msg.sender distinction, invoice replay key, pooled-custody removal, v4 direction/currency-order/exact-output convention, hook context authentication) that the verification register established. Deeper verification entries will be pulled on demand in later stages when a specific mechanic needs re-checking. |
| CLAIMS | `01_CLAIMS_EXTRACTED.md` (721 lines) | **Established correspondence:** byte-identical to REVIEW Section 1 (C001-C227), confirmed via `diff` of the claim bodies (L3-721 of the standalone file vs L15-733 of REVIEW). No plain-numbered/C-ID mismatch exists in this repository's copies — both already use C001-style IDs with matching text. The only differences are the standalone file's missing trailing ledger-summary line and a shorter source-link footer (`[DRAFT]` only vs REVIEW's full retrieved-source register). Do not treat this 1:1 finding as generic; it is specific to these two files as they exist now. |
| ENGINEERING_ANALYSIS.md | not present in this repository | Referenced only as `[DRAFT]` inputs source by CLAIMS/REVIEW footnotes; the file itself is not in this repo. Not treated as accepted behavior per CLAUDE.md instruction regardless. |

## Path correction (B0, 2026-09-17)

The paths above were recorded at Stage 1 as repository-root paths. The 2026-09-14 docs pack (`89520b0`) moved REVIEW, ARCH, API, VERIFICATION, CLAIMS into `docs/` (e.g. `docs/03_REBUILT_ARCHITECTURE.md`, `docs/API_CONTRACT.md`). `DATABASE_SCHEMA.sql` and `reference/CONTRACT_INTERFACE.sol` stayed at their original root/`reference/` paths — unchanged. Content and line counts are unaffected; only the directory prefix changed. Do not treat this as a second copy — `git log --follow` confirms straight renames, no forks.

## Precedence (superseded 2026-09-14, B0)

`PAYGUARD_BUILD_PROMPTS.md` (Stage 1-7, no-UI, mandatory-subsidy, Aqua-deferred scope) no longer exists in this repository and is superseded. Current governing documents, per `docs/00_PAYGUARD_START_HERE.md`:

- Product scope and sponsor selection: `docs/PAYGUARD_FINAL_HACKATHON_MVP.md` — real independent Uniswap v4 AND Aqua/SwapVM routes both required; merchant LP subsidy optional; owner UI required (frontend reused from `main`, not rebuilt).
- Shared execution rules, gates, review/checkpoint protocol: `docs/PAYGUARD_AGENT_WORKFLOW.md`.
- Selected-task prompts: `docs/PAYGUARD_BACKEND_PROMPTS.md` (B0-B5), `docs/PAYGUARD_FRONTEND_PROMPTS.md` (F0-F3), `docs/PAYGUARD_RELEASE_PROMPT.md` (R1).
- Document migration plan: `docs/PAYGUARD_DOCS_CLEANUP.md`.

ARCH supplies the selected design; API/INTERFACE/DB specify their respective boundaries; VERIFICATION supplies corrections/evidence limits, not a second backlog. REVIEW's open questions (O01-O17) remain open until their required test actually runs — tracked in `BUILD_SCOPE.md` and `DECISIONS.md` as they become relevant to a gate. Where the final MVP plan conflicts with ARCH/REVIEW's older no-UI/subsidy-required/Aqua-deferred framing, the final MVP plan controls (see `BUILD_SCOPE.md` decision below).

No conflicts found between ARCH/API/DB/INTERFACE during Stage 1 reading — INTERFACE's struct/enum/function shapes match API's canonical models and ARCH's state/function-level design tables field-for-field (spot-checked: PolicyConfig, Invoice, PaymentIntent, ExceptionApproval, Evaluation all match across the three documents). This finding still holds; it is orthogonal to the precedence supersession above.
