# PayGuard acceptance, demo and evidence matrix

Version 2.0. Required scope: core payment product + independent Uniswap v4 and Aqua/SwapVM routes + reused functional owner UI. Subsidy is NOT_SELECTED unless separately authorized later.

## Gate distinction

B5 proves a backend/API product path, not a browser product. F3 proves the browser on the combined implementation. R1 checks the release candidate and submission evidence. Sponsor eligibility is an independent confirmed/unconfirmed field, not a test-suite pass.

Run targeted tests at each step and one coherent combined regression at R1. Do not recursively execute every old stage at every new stage. Preserve old evidence and record fresh code/deployment/lock identity for new runs.

## Required acceptance matrix

| ID | Required behavior | Evidence / gate |
|---|---|---|
| A01 | Existing backend work and prior history survive doc reset and frontend import | B0/F0 Git status, source/provenance map and preserved dirty/untracked fingerprint |
| A02 | Response shapes match real populated read models; historical payment resolves its executed policy/intent | B1 real PostgreSQL/API tests, replacement/supersession history case |
| A03 | Wrong chain, vault code, binding, schema or enabled-route configuration fails readiness/preparation | B1 negative config/runtime tests, B3/B4 extension |
| A04 | Owner session, agent session and spending signatures remain separate | B1/B2 tests; F1 real browser cookie/signature flow |
| A05 | Amounts round-trip exactly, including 2^53+1 and supported uint256 boundaries | B1/F1 shared/schema tests; reject bad precision, exponent, signs and width |
| A06 | Direct ALLOW pays exact supported token amount and consumes one invoice | B2 public HTTP -> worker -> real chain -> receipt -> GET |
| A07 | Preflight BLOCK moves no funds and creates no invented surviving chain denial event | B2 actual refusal/evaluation evidence |
| A08 | ESCALATE requires exact owner approval and still respects all hard limits | B2 tests; F1 browser signature; F2 owner review |
| A09 | Changed protected fields, wrong signer/domain, expired or cancelled approval are rejected | Existing contract regressions + B2/F1 mutation cases |
| A10 | Same invoice cannot be paid twice across intent nonces/policies/routes | B2/B3/B4 actual replay attempts; one legitimate obligation |
| A11 | Lost command response returns same run/operation; repeated click does not create a new payment | B2/F3 idempotency plus browser duplicate-submit case |
| A12 | Broadcast accepted then timeout/restart recovers the same journal identity | B1/B2/B5 real worker with injected transport failure |
| A13 | Reorg nonce recovery does not stall or allocate conflicting business payments | B1 regression for SPEC-037 with pending/signed/unsigned cases |
| A14 | Real v4 exact-output conversion honors input bound, recipient and refund rules | B3 official protocol deployment, balances/deltas, protocol/payment receipts |
| A15 | v4 insufficient output/liquidity or max-input failure restores payment authority | B3 negative transaction with before/after consumption and counters |
| A16 | Real Aqua strategy is shipped, filled and reflected in actual token movement | B4 official source/SDK graph, registry/strategy identity, protocol/payment receipts |
| A17 | Aqua unavailable/docked/expired strategy or depleted inventory fails without consuming PayGuard payment authority | B4 actual registry/router negative cases |
| A18 | Payer-side finite allowances and callback/reentry boundaries hold on both routes | B3/B4 invariant/adversarial tests; existing vault behavior preserved |
| A19 | Same-origin browser auth works and rejects wrong Origin/CSRF | F1 real browser test, not only Fastify injection |
| A20 | Owner finite approval/deposit, policy create/replace/revoke and withdrawal/pause produce real observed outcomes | F2 wallet and chain observations; approval alone not deposit |
| A21 | Wallet account/chain changes invalidate stale session/prepared/signing controls | F1/F2 browser/provider tests |
| A22 | Browser cannot show paid for API 2xx, hash, QUEUED, SUBMITTED, UNKNOWN or receipt mismatch | F1/F3 explicit state fixtures + real outcome |
| A23 | Reload restores durable activity and an in-flight operation without replay | F3 browser reload during pending/UNKNOWN and after terminal |
| A24 | Main's presentation is reused; fake ledger/server/contracts are not in active product runtime | F0/F3 import map, network calls, build/import checks |
| A25 | Both sponsor routes execute through actual UI/API/worker/vault, not standalone protocol scripts only | F3/R1 browser-driven separate purchases + receipts |
| A26 | Mock assets, deterministic agent, local environment, disabled subsidy and policy budgets are labeled accurately | F3 copy review + screenshots |
| A27 | Clean setup/restart and safe reset are reproducible; old-domain signatures are not accidentally valid after reset | B2/B5/R1 chain-domain/deployment tests |
| A28 | Required sponsor code maps, feedback material and prior-work disclosure exist; form submission/eligibility state is truthful | R1 separate implementation and organizer checklists |

Use real DB and chain where specified. A transport mock can inject a timeout around a real accepted transaction; a fake tx hash cannot prove recovery. A test-only wallet provider can prove browser application behavior but must not be labeled a tested wallet extension.

## Scenario profiles

Use clearly separate v4 and Aqua agent keys/policies. For the primary profile, example output limits are 300 mUSDC total, 100 automatic cap and 200 escalation ceiling. Choose a sufficient compatible epoch budget and owner-reviewed input exposure limits from the seeded liquidity; do not hardcode an invented mRWA conversion result. The Aqua profile has its own explicitly shown budget.

Keep a separate direct reference profile for diagnostics and pre-adapter browser proof. A successful direct run is not evidence of v4/Aqua integration. All policies use supported plain tokens with explicit decimals; mock values are not USD market valuations.

Each intentional new purchase receives a fresh invoice identity. Retries of the same purchase keep that identity. A duplicate test reuses it deliberately. Do not create a new invoice as an automatic recovery for an uncertain payment.

## Main narrative

1. Show real owner-approved limits, permitted merchants and assets.
2. Issue a 0.50 mUSDC Demo Compute invoice and submit the v4 agent's signed intent. Show actual conversion and exact merchant receipt.
3. Propose an over-budget 500 mUSDC invoice. Display the actual first rejection reason and whether refusal occurred at API validation or contract evaluation. Do not prewrite a false trace.
4. Issue a 180 mUSDC Demo Hotel invoice. Show ESCALATE, then real owner typed signature, then exact settlement.
5. Select the separate Aqua profile and issue a DIFFERENT small invoice. Show actual shipped strategy/fill and merchant receipt.
6. Open activity/receipt, copy a real hash and show durable history. Duplicate/restart/failure demonstrations may be used for Q&A without expanding the UI into an operations console.

Under-cap unauthorized-merchant requests are useful to show more than budget arithmetic. If the public API rejects before a payment resource exists, show that truthful rejection and test the vault's independent rejection separately. Do not weaken API checks to manufacture a stage event.

Actual timing depends on wallet/RPC/runtime. Do not promise fixed live settlement seconds or skip real wallet waits through fake success. The dated sponsor notes contain event presentation requirements; recheck before recording/submission.

## Evidence bundle produced by the agent

Under existing `docs/implementation/evidence/mvp-v2/`, retain a sanitized record for each required scenario:

- Source locks/commits, build manifest, chain/deployment/vault/route identity.
- Policy, invoice, intent and approval digests and non-secret identifiers.
- Actor addresses, requested output, signed max input and actual observed amounts.
- Real transaction hash, canonical receipt/block identity, relevant expected events and reconciliation.
- Before/after invoice consumption, budget counters and token deltas for success/failure cases.
- Exact commands, exit codes, fault injection details and reproduction steps.
- Browser screenshots/network traces where meaningful, with secrets/cookies/signatures redacted from public material.

Do not put private keys, session tokens, full secrets or unrestricted signing payloads into public logs. Local fixture keys must be visibly test-only and never reused for assets of value.

## Release report axes

Report separately:

```text
Core backend: PASS | FAIL | BLOCKED
Direct reference: PASS | FAIL | BLOCKED
Uniswap route through product: PASS | FAIL | BLOCKED
Aqua route through product: PASS | FAIL | BLOCKED
Browser owner journey: PASS | FAIL | BLOCKED
Receipt/recovery truth: PASS | FAIL | BLOCKED
Optional subsidy: NOT_SELECTED | PASS | FAIL | BLOCKED
Technical MVP: READY | NOT_READY
Sponsor eligibility: CONFIRMED | UNCONFIRMED | NOT_ELIGIBLE
Submission artifacts: COMPLETE | INCOMPLETE
```

A one-route/direct-only fallback can be a working reduced product. It cannot be reported as the required two-route MVP passing. Changing the selected sponsor target is a human scope decision, not a test shortcut.

## What not to add for acceptance

No multi-region operations, production scale benchmarks, generic analytics, open merchant directory, new token standards, reorg dashboard, complex query framework, new custody model or AI planner. Keep existing tests and fix actual defects. The goal is a demonstrated product, not a checklist of infrastructure names.
