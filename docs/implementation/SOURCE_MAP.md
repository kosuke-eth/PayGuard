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

## Precedence

Per shared execution contract: current user-approved scope (`PAYGUARD_BUILD_PROMPTS.md` selected scope table) controls product requirements. ARCH supplies the selected design. API/INTERFACE/DB specify their respective boundaries. VERIFICATION supplies corrections/evidence limits, not a second backlog. REVIEW's open questions (O01-O17) remain open until their required test actually runs — tracked in `BUILD_SCOPE.md` and `DECISIONS.md` as they become relevant to a stage.

No conflicts found between ARCH/API/DB/INTERFACE during Stage 1 reading — INTERFACE's struct/enum/function shapes match API's canonical models and ARCH's state/function-level design tables field-for-field (spot-checked: PolicyConfig, Invoice, PaymentIntent, ExceptionApproval, Evaluation all match across the three documents).
