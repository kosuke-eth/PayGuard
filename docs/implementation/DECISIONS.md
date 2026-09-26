# PayGuard decisions (append-only)

Each entry: conflicting file/section, selected resolution, evidence, API/ABI/DB impact, invalidated gates, approval status. These are reconciliations required by Prompt 1 item 5, resolved from existing source evidence — none change custody, external authority, or scope, so none required a user question.

## SPEC-001: policy replacement/supersession semantics

**Gap:** ARCH 3.3 states "Policies are immutable once created; replacement marks a previous active policy inactive," and the state model lists `activePolicyForAgent[agent]` as a single slot. `DATABASE_SCHEMA.sql policies.observed_status` includes `SUPERSEDED` as a distinct value from `REVOKED`, but neither ARCH nor INTERFACE says what on-chain signal distinguishes "superseded by a newer policy for the same agent" from "explicitly revoked by `revokePolicy`."

**Resolution:** `createPolicy` for an agent that already has an active policy overwrites `activePolicyForAgent[agent]` to the new `policyId` as part of the same transaction; it does not call `revokePolicy` on the old one and does not set any `revoked` bit on the old policy. On-chain, a policy's live "active" state is therefore derived, not stored directly: `getPolicyState(policyId).active` is computed as `activePolicyForAgent[getPolicy(policyId).agent] == policyId && !policies[policyId].revoked`. The backend projection distinguishes the two off-chain: on a `PolicyCreated` event for an agent who already had a different active policy in the DB projection, mark the prior policy row `SUPERSEDED`; on an observed `PolicyRevoked` event, mark the referenced policy `REVOKED`. Both leave `getPolicyState(oldPolicyId).active == false` on-chain — the DB distinction is purely a read-model convenience, never a source of authority.

**Evidence:** ARCH 3.3 "State and replay identities" table (single `activePolicyForAgent[agent]` slot, no per-policy active flag); `DATABASE_SCHEMA.sql` line defining `policies.observed_status CHECK (... IN ('ACTIVE','REVOKED','SUPERSEDED','EXPIRED','ORPHANED'))`; `reference/CONTRACT_INTERFACE.sol` `PolicyState` struct (has `active`/`revoked`, no `superseded` bit).

**Impact:** Stage 2 `PayGuardVault.createPolicy`/`getPolicyState` implementation; Stage 3/5 policy-projection worker logic (event handler must compare against the DB's current `activePolicyForAgent`-equivalent projection, not just the event payload, to decide SUPERSEDED vs no-op).

**Invalidated gates:** none yet (Stage 2+ concern).

**Approval:** resolvable from evidence; no user question needed — does not change authority or external behavior, only clarifies an internal derivation rule already implied by the two documents.

## SPEC-002: zero/absent approval validation rule

**Gap:** API says "Optional empty approval is encoded as a zero-valued approval struct plus empty signature; the execution validator ignores that pair only for an ALLOW not requiring exception." Neither API nor INTERFACE states what happens if a non-zero-but-invalid approval is submitted for a payment that did not actually need escalation, or what "zero-valued" means field-by-field.

**Resolution:** "Zero-valued approval" means `intentHash == bytes32(0) && nonce == 0 && validUntil == 0` with `ownerSignature.length == 0`. The vault's shared validation path checks this exact tuple *before* attempting any signature recovery: if it matches, the owner-signature branch is skipped entirely regardless of decision, and `Evaluation.signaturesChecked` reflects only agent+merchant checks. If the tuple is anything else (including a non-zero approval on a payment that turns out not to need it), the vault always attempts full approval validation (intent-hash binding, nonce unused/uncancelled, signature recovery) and reverts `INVALID_APPROVAL` on failure — it never silently ignores a malformed non-empty approval just because the payment didn't strictly require one. This prevents malformed optional data from being used to probe or silently expand authority, per the CLAUDE.md invariant.

**Evidence:** `API_CONTRACT.md` "Canonical business models" section; `reference/CONTRACT_INTERFACE.sol` `ExceptionApproval` struct and `Reason.INVALID_APPROVAL`; CLAUDE.md invariants ("Do not let malformed optional data silently expand authority" — this exact phrase is from `PAYGUARD_BUILD_PROMPTS.md` Prompt 2 item 3, applied here at Stage 1 reconciliation time since it governs the shared EIP-712/validation baseline).

**Impact:** `packages/domain` shared evaluate/validate logic (to be implemented in Stage 2, but the zero-tuple definition is a shared-schema concern established now); `contracts/core-v4`... actually PayGuardVault itself is Stage 2, not Stage 1 — this SPEC fixes the *rule* for Stage 2 to implement, and fixes the EIP-712 fixture/vector definition of "empty approval" used in Stage 1's cross-language vectors.

**Invalidated gates:** none (Stage 1 vectors will include one explicit zero-approval-tuple case per this definition).

**Approval:** resolvable from evidence.

## SPEC-003: EIP-712 struct field order (confirmed, not a gap)

**Check:** Prompt 1 item 5 asks to reconcile "exact signature argument order." Verified by direct inspection: `reference/CONTRACT_INTERFACE.sol` gives each struct's field order directly (`PolicyConfig`, `MerchantPermission`, `Invoice`, `PaymentIntent`, `ExceptionApproval`), and Solidity ABI encoding for EIP-712 `encodeData` follows struct declaration order exactly (no ambiguity — this is EIP-712's own rule, not a PayGuard choice). `API_CONTRACT.md`'s "Canonical business models" section lists the same fields in the same order for all four signed/hashed types.

**Resolution:** No correction needed. The TypeScript EIP-712 type descriptors in `packages/domain/src/eip712.ts` (Stage 1) use exactly the field order and Solidity types from `reference/CONTRACT_INTERFACE.sol`, confirmed field-for-field against `API_CONTRACT.md`. All four structs (`Invoice`, `PaymentIntent`, `ExceptionApproval`, plus `PolicyConfig`/`MerchantPermission` which are not directly signed but are hashed into `configHash`) contain only fixed-width scalar fields (`address`, `bytes32`, `uint256`/`uint48`/`uint32`, one `enum` encoded as `uint8`) — no dynamic types, so no nested-hash step applies.

**Evidence:** `reference/CONTRACT_INTERFACE.sol` lines 17-63; `API_CONTRACT.md` "Canonical business models" and "The wire category string converts to uint32..." paragraph (explicit enum-to-uint8 conversion rule).

**Impact:** none — confirms the Stage 1 shared-schema implementation is correct by construction.

**Approval:** resolvable from evidence.

## SPEC-004: sessionKind persistence from challenge to verification

**Gap:** `PAYGUARD_BUILD_PROMPTS.md` Prompt 4 requires "Store the intended sessionKind at challenge creation so a caller cannot swap credential-delivery modes during verification." `API_CONTRACT.md`'s `POST /v1/auth/challenges` request includes `sessionKind:'BROWSER'|'AGENT'`. But `DATABASE_SCHEMA.sql`'s `auth_challenges` table has **no `session_kind` column** — only `sessions.session_kind` exists, written at verify-time. As proposed, nothing stops `POST /v1/auth/verify` from choosing a different `sessionKind` than what was requested at challenge time.

**Resolution:** `auth_challenges` needs an additional column: `session_kind text NOT NULL CHECK(session_kind IN ('BROWSER','AGENT'))`, written at challenge creation. `POST /v1/auth/verify` reads this stored value and uses it directly when creating the `sessions` row — verify-time does not accept or trust a client-supplied `sessionKind` at all (the original request did not offer one, consistent with `API_CONTRACT.md`'s verify request shape `{challengeId, signature}`, which already has no `sessionKind` field — confirming the value must come from the stored challenge, not the verify call).

**Evidence:** `PAYGUARD_BUILD_PROMPTS.md` Prompt 4 §2; `API_CONTRACT.md` `POST /v1/auth/challenges` and `POST /v1/auth/verify` sections; `DATABASE_SCHEMA.sql` `auth_challenges`/`sessions` table definitions (gap confirmed by direct column absence).

**Impact:** `DATABASE_SCHEMA.sql`/Stage 3 migration must add this column (recorded here now so Stage 3 doesn't have to rediscover the gap); `docs/implementation/TRACEABILITY.md` entry for the SIWE challenge/verify flow.

**Invalidated gates:** none (Stage 3/4 concern; Stage 1 does not implement auth).

**Approval:** resolvable from evidence; additive column, no authority change.

## SPEC-005: prepared owner-transaction correlation (confirmed pattern, formalized)

**Gap:** How does `POST /v1/chain-observations` correlate a client-supplied `txHash` + `relatedResourceId` hint back to the specific prepared calldata, without trusting the hint?

**Resolution:** `operations.request_digest` (already in `DATABASE_SCHEMA.sql`) is the calldata digest computed at prepare time (`POST /v1/vaults/{id}/transactions`, `POST /v1/policy-drafts/{id}/transaction`, etc.). `POST /v1/chain-observations` fetches the receipt for the hinted `txHash`, decodes its actual `to`/`data`, recomputes the digest, and requires it equal the stored `operations.request_digest` for the `relatedResourceId` before marking the operation `COMPLETED` or activating the related policy/effect. A hash that decodes to different calldata, wrong `to`, or a failed/non-canonical receipt leaves the operation `UNKNOWN`/`FAILED` and never activates the resource. This matches `API_CONTRACT.md`'s "A supplied txHash is only a hint, never a status assignment" and ARCH's "Verify actual destination, calldata/configuration, receipt and event before activating the related policy."

**Evidence:** `API_CONTRACT.md` `POST /v1/chain-observations`; `03_REBUILT_ARCHITECTURE.md` §3.1 endpoint table and §3.4 reconciliation contract; `DATABASE_SCHEMA.sql` `operations.request_digest`/`immutable_request`/`transaction_hash` columns.

**Impact:** Stage 4 API handler design, Stage 5 worker receipt-validation primitive (ARCH explicitly says this primitive is shared between API Stage 4 tests and the Stage 5 worker).

**Approval:** resolvable from evidence; formalizes an already-implied design, no new authority.

## SPEC-006: multi-transaction deposit (approve + deposit) operation-step tracking

**Gap:** `POST /v1/vaults/{id}/transactions` for a `DEPOSIT` needing approval returns **one** `operationId` but **two** `UnsignedTransaction`s (`approve` then `deposit`). `DATABASE_SCHEMA.sql`'s `operations` table has a single `transaction_hash hash32` column — insufficient to track two distinct transaction hashes/statuses under one operation.

**Resolution:** Use the existing `operations.result jsonb` column to hold an ordered step array for multi-step operations: `result = {"steps": [{"kind":"APPROVE","transactionHash":null,"status":"PENDING"}, {"kind":"DEPOSIT","transactionHash":null,"status":"PENDING"}]}`, updated in place as each step's chain-observation resolves (per SPEC-005's correlation rule, applied per-step). `operations.transaction_hash` (the single top-level column) is populated only for single-transaction operations (revoke/pause/cancel-nonce, or a deposit that needed no approval because an existing allowance already covered it); it stays `NULL` for multi-step deposits, with the per-step hashes living in `result.steps[].transactionHash` instead. The operation is `COMPLETED` only when the step whose `kind` is the intended final effect (`DEPOSIT`, not `APPROVE`) resolves successfully — matching `API_CONTRACT.md`'s "Approval alone is not deposit completion."

**Evidence:** `API_CONTRACT.md` `POST /v1/vaults/{id}/transactions` section; `03_REBUILT_ARCHITECTURE.md` §3.5 "Funding and owner controls"; `DATABASE_SCHEMA.sql` `operations` table (`result jsonb` column already present, reused rather than adding a new table at this stage).

**Impact:** Stage 4 API handler for `POST /v1/vaults/{id}/transactions` and `POST /v1/chain-observations`; Stage 3 may add a normalized `operation_steps` table later if `jsonb` proves insufficient for concurrent-step querying — that would be a future SPEC, not decided now.

**Approval:** resolvable from evidence; additive use of an existing column, no schema-breaking change.

## SPEC-007: actual settlement read-model derivation path

**Gap:** `API_CONTRACT.md`'s `PaymentView.settlement` (`actualInputAtomic`, `outputDeliveredAtomic`, `subsidyAmountAtomic`) has no corresponding dedicated columns in `payments` or a settlement-specific table in `DATABASE_SCHEMA.sql`.

**Resolution:** Settlement fields are derived at read time, not stored redundantly: join the payment's currently-active `payment_intents` row (`retired_at IS NULL`) to `nonce_families` on `intent_id`, to `transaction_attempts` on `nonce_family_id` filtered to the canonical successful attempt (`state='SUCCEEDED'` and its receipt's block is `canonical`), to `chain_events` on `tx_hash` filtered to `decoded_name='PaymentExecuted'` and `canonical=true`. The event's `decoded_payload` (matching `PaymentExecuted`'s ABI fields: `actualInput`, `exactOutput`, `subsidyAmount`) is the source of the three settlement amounts. `payments.reconciliation` is set to `MATCHED` only after this join is verified against the intent's bound `invoiceHash`/`policyId`/tokens/route per ARCH §3.4's reconciliation contract; a decoded `PaymentExecuted` from the wrong intent/invoice is not treated as this payment's settlement.

**Evidence:** `API_CONTRACT.md` `PaymentView` shape; `03_REBUILT_ARCHITECTURE.md` §3.4 "Reconciliation contract"; `DATABASE_SCHEMA.sql` `chain_events.decoded_payload`, `payment_intents`, `nonce_families`, `transaction_attempts` tables; `reference/CONTRACT_INTERFACE.sol` `PaymentExecuted` event fields.

**Impact:** Stage 4 `GET /v1/payments/{id}` handler query; Stage 5 worker's event-projection step (must populate `chain_events.decoded_name`/`decoded_payload` correctly for this join to work — an implicit Stage 5 requirement now made explicit).

**Approval:** resolvable from evidence; no new column added, a query pattern is specified instead.

## SPEC-008: recovery after nonce allocation but before signing

**Gap:** ARCH §3.4 requires recovering "an allocated-but-unsigned family explicitly after a crash," but does not give the exact query/identity rule.

**Resolution:** On worker startup (and periodically), the worker queries: `SELECT * FROM nonce_families WHERE deployment_id=$1 AND sender=$2 AND closed_at IS NULL AND id NOT IN (SELECT nonce_family_id FROM transaction_attempts)`. Each row found is "allocated but unsigned" — the worker deterministically reconstructs the same signed transaction from the persisted `unsigned_request` (same `to`/`value`/`calldata`, same `nonce`) rather than allocating a new nonce family for the same `intent_id` (enforced anyway by the `one_open_nonce_family_per_intent` partial unique index already in `DATABASE_SCHEMA.sql`). If signing now fails deterministically (e.g., a config error), the family stays open and unsigned until fixed; the worker never silently skips the nonce (per ARCH's "do not increment past it").

**Evidence:** `03_REBUILT_ARCHITECTURE.md` §3.4 "Transaction journal and nonce allocation"; `DATABASE_SCHEMA.sql` `nonce_families`/`transaction_attempts` tables and `one_open_nonce_family_per_intent` unique index.

**Impact:** Stage 5 worker startup/recovery routine — this SPEC fixes the exact query Stage 5 must implement, resolved now so Stage 5 doesn't invent a different recovery identity.

**Approval:** resolvable from evidence.

## SPEC-009: local reset replay/domain strategy

**Gap:** A new `deployments` row (new UUID) does not by itself change the EIP-712 domain (`chainId`, `verifyingContract`), so old signatures from a prior local deployment instance could remain valid against a redeployed vault unless something concrete changes.

**Resolution:** Every local reset in this project **redeploys `PayGuardVault` fresh at a new contract address** as part of the reset/deployment script (Stage 1's Anvil fixture already does this for `PoolManager`+test tokens; the same pattern is used for the vault from Stage 2 onward). Because `verifyingContract` is part of the EIP-712 domain and equals the vault's address, a fresh deployment address alone invalidates all prior signatures — no chain-ID change or new signed field is needed, matching the "use an actually fresh verifying-contract address... do not silently add new signed fields" instruction. The `deployments` table's existing `instance_label text NOT NULL UNIQUE` and `genesis_or_anchor_hash hash32 NOT NULL` columns (already in `DATABASE_SCHEMA.sql`) distinguish this new instance from the prior one at the same `chain_id` (local Anvil default `31337`), so the backend never conflates two local deployment instances' projections even though `chainId` is unchanged between resets.

**Evidence:** `03_REBUILT_ARCHITECTURE.md` §3.4 "A local chain reset starts a new deployment instance and clears/archive-separates the corresponding application projection, rather than reusing old successful payments"; `DATABASE_SCHEMA.sql` `deployments` table; Prompt 1 item 5's explicit instruction on this point.

**Impact:** `contracts/core-v4` deploy script (Stage 1's fixture deploy script establishes the pattern); Stage 3's deployment-instance bootstrap fixture.

**Tested reset strategy:** Stage 1 proves this two ways. (1) `contracts/core-v4/test/V4SwapFixture.t.sol` redeploys `PoolManager`+mock tokens fresh inside forge test's own EVM on every run (no persisted state ever). (2) `packages/chain/test/v4-anvil-fixture.test.ts` spawns a literal fresh `anvil` process per test run (`@payguard/test-utils` spawnAnvil, no `--state` flag) and broadcasts a fresh deployment to it via `contracts/core-v4/script/DeployFixture.s.sol` — a new contract address every run, exactly the mechanism this SPEC requires. The vault-specific version is a Stage 2 concern reusing the same mechanism.

**Approval:** resolvable from evidence.

## SPEC-010: `_evaluate` decision-precedence order (Stage 2)

**Gap:** Prompt 2 item 5 requires "a stable documented precedence so multiple simultaneous violations do not produce misleading UI assumptions," and ARCH's function-level design describes each check but not an exact total order across all of them. `reference/CONTRACT_INTERFACE.sol`'s `Reason` enum declaration order is a strong signal but not itself a complete precedence — some checks have hard data dependencies (e.g. the merchant signature cannot be checked before the merchant snapshot is looked up, even though `MERCHANT_NOT_ALLOWED` and the merchant-signature branch of `INVALID_SIGNATURE` are not adjacent enum values) that force a specific order regardless of enum position.

**Resolution:** `PayGuardVault._evaluate` (`src/PayGuardVault.sol:308-488`) uses the `Reason` enum's declared order as the backbone, with documented, data-dependency-driven reordering where a later-declared reason must structurally be checked before an earlier-declared one can even be evaluated. The fixed order, as implemented and commented at the top of the contract: invoiceHash binding -> agent signature -> policy existence/active/revoked -> time bounds (policy/invoice/intent) -> agent-revoked -> merchant exists+recipient-bound -> merchant signature -> category -> settlement token -> route -> amount sanity (`outputAmount == 0`) -> invoice replay -> agent-nonce replay -> hard output budgets (total, then epoch) -> hard input budget -> per-payment input ceiling -> escalation ceiling (hard, unconditional) -> automatic-cap approval (only reached once every hard rule above already passed) -> execution pause -> subsidy mode (Stage 2: any non-NONE `PaymentIntent.subsidyMode` is rejected gracefully as `SUBSIDY_UNAVAILABLE`, since subsidy composition is Stage 6 scope) -> route-specific structural checks (direct route: input==settlement token and vault balance sufficiency). Two consequences worth recording: (1) `INVALID_AMOUNT` (enum position 21, last) is checked well before the budget/approval group, not last, because a zero-amount invoice is a malformed-input case that should never reach spend-accounting logic; (2) a payment whose `intent.maxInputAmount` exceeds the policy's `maxInputPerPayment` reports `MAX_INPUT_LIMIT` even when the payment would *also* have exceeded `escalationOutputCap`, since the per-payment input ceiling is checked first — this is intentional (both are hard rules; the specific one reported first is a diagnostic-only choice with no bypass implication), and is exercised directly by `contracts/core-v4/test/EvaluationNegative.t.sol:test_oversizedAmount_aboveEscalationCeiling` and `contracts/core-v4/test/Approvals.t.sol:test_approval_cannotBypassEscalationCeiling`, both of which had to raise `maxInputPerPayment` on their test policy specifically to reach the escalation check at all — direct evidence the precedence is real and stable, not accidental.

**Evidence:** `reference/CONTRACT_INTERFACE.sol` `Reason` enum; `PAYGUARD_BUILD_PROMPTS.md` Prompt 2 item 5; `contracts/core-v4/src/PayGuardVault.sol` `_evaluate` implementation and its header comment; the two test files named above (independent confirmation the order is load-bearing, discovered empirically while writing the tests, not asserted from documentation alone — see checkpoint 02's review-findings section).

**Impact:** `contracts/core-v4/src/PayGuardVault.sol` (`_evaluate`); `API_CONTRACT.md`/future frontend-integration docs should describe this same order so a UI never implies a payment is "closer to succeeding" than the first-reported `Reason` indicates.

**Invalidated gates:** none (Stage 2 concern, defined and tested now).

**Approval:** resolvable from evidence and Prompt 2's own instruction to document a stable precedence; does not change authority — only which single `Reason` is reported when multiple violations coexist.

## SPEC-011: operations needs its own compare-and-set version column (Stage 3)

**Gap:** Prompt 3 item 4 requires "Enforce allowed transitions with state-version compare-and-set updates in SQL" for every status axis, including operation status. `DATABASE_SCHEMA.sql`'s `operations` table has no version column at all -- `payments.state_version` exists and covers the four payment axes (policyDecision/executionStatus/confidence/reconciliation), but `operations` (a structurally separate table, covering owner configuration/funding transactions and queued agent submissions) had nothing equivalent. Without it, a status update could only be guarded by matching the previous `status` value itself, which breaks the moment two different valid prior states could legally transition to the same next state (e.g. both `QUEUED` and `UNKNOWN` retry to `IN_PROGRESS`) -- the WHERE clause can no longer distinguish "nothing changed since I read this row" from "something else already changed it to the same status I expected."

**Resolution:** Migration `0003_operations_state_version.sql` adds `operations.state_version bigint NOT NULL DEFAULT 1 CHECK (state_version >= 1)`, matching the pattern already used on `payments`/`outbox`/`indexer_cursors`. `packages/db/src/repositories/operations.ts`'s `updateOperationStep` and `completeSingleTransactionOperation` both require an `expectedVersion` and issue `UPDATE ... WHERE id = $1 AND state_version = $2`; there is no other code path in this package that writes to `operations.status` or `operations.result`.

**Evidence:** `DATABASE_SCHEMA.sql` `operations` table definition (no version column); `PAYGUARD_BUILD_PROMPTS.md` Prompt 3 item 4; `packages/db/migrations/0003_operations_state_version.sql`; `packages/db/src/repositories/operations.ts`; regression test `packages/db/test/03-casAndIdempotency.test.ts` ("operations: multi-step completion (SPEC-006)" suite, which exercises the CAS path directly).

**Impact:** `packages/db/migrations/0003_operations_state_version.sql`; `packages/db/src/repositories/operations.ts`.

**Invalidated gates:** none (Stage 3 concern, defined and tested now).

**Approval:** resolvable from evidence; additive column, no authority change.

## SPEC-012: signed evidence immutability enforced at the SQL layer, not just by omission (Stage 3)

**Gap:** CLAUDE.md's invariant "Signed evidence is immutable under ordinary application operations" and Prompt 3 item 2 are satisfiable by simply never writing an UPDATE-signed_artifacts code path -- but that leaves the guarantee resting entirely on every future caller (across all later stages) remembering not to add one, with no enforcement if they don't.

**Resolution:** Migration `0002_corrections.sql` adds a `BEFORE UPDATE` trigger (`signed_artifacts_immutable` / `reject_signed_artifact_update()`) that unconditionally raises on any UPDATE to `signed_artifacts`, regardless of which columns are touched or which application code path attempts it. `packages/db/src/repositories/artifacts.ts` correspondingly exposes no update function at all -- the repository layer and the database schema enforce the same invariant independently, not just the repository layer alone.

**Evidence:** CLAUDE.md "Preserve signatures and the schema/domain version needed to recompute each digest. Signed evidence is immutable under ordinary application operations."; `packages/db/migrations/0002_corrections.sql`; test `packages/db/test/02-numericAndConstraints.test.ts` "rejects an UPDATE against an existing signed_artifacts row".

**Impact:** `packages/db/migrations/0002_corrections.sql`; `packages/db/src/repositories/artifacts.ts`.

**Invalidated gates:** none.

**Approval:** resolvable from evidence; strictly additive safety, no authority change.


## SPEC-013: transaction_attempts/nonce_families writes needed compare-and-set guards, cross-checked linkage, and real tests (Stage 3, fresh-review HIGH finding)

**Gap:** The fresh-context adversarial review of Stage 3 (`agent-skills:security-auditor`) found that `packages/db/src/repositories/txJournal.ts` -- the durable nonce-allocation/transaction-journal layer Prompt 3 item 6 specifically asks for -- was the one repository in the package not following the CAS discipline used everywhere else. `markBroadcast` and `attachCanonicalReceipt` issued unconditional `UPDATE transaction_attempts SET state = ...` with no check of the row's current state, unlike `payments.state_version`, `operations.state_version`, `outbox.lease_owner/lease_version`, and `indexer_cursors.lease_version`. `attachCanonicalReceipt` also closed `nonce_families` without checking `closed_at IS NULL` first, and never verified that its `attemptId` parameter actually belonged to its `nonceFamilyId` parameter -- two independently-supplied ids trusted to already agree. `recordFeeReplacement` had the same shape of gap: it trusted a caller-supplied `nonceFamilyId` instead of deriving it from the `replacementOfId` attempt it was replacing. The review additionally found zero tests anywhere in the suite exercised `reserveNonceFamily`, `recoverUnsignedFamilies`, `recordSignedAttempt`, `recordFeeReplacement`, `markBroadcast`, `attachCanonicalReceipt`, or `recordRebroadcast` -- the highest-risk subsystem in the package (a duplicate/out-of-order worker call here can silently regress observed chain state or misattribute a canonical receipt) had no empirical evidence behind it at all.

**Resolution:** Added `transaction_attempts.state`'s pure transition-legality graph to `packages/db/src/stateTransitions.ts` (`isTransactionAttemptStateTransitionAllowed`, the same `Graph`/`isAllowed` pattern as the four payment axes and operation status) and a matching `InvalidTransactionAttemptStateTransitionError`. `markBroadcast` now locks the row (`SELECT ... FOR UPDATE`), only accepts a current state of `SIGNED` or `SUBMITTED`, and issues `UPDATE ... WHERE id = $1 AND state = $2`; a duplicate broadcast call is an idempotent no-op rather than a silent overwrite. `attachCanonicalReceipt` locks the row, rejects a mismatched `attemptId`/`nonceFamilyId` pairing outright, treats a same-state re-delivery as an idempotent no-op only if the nonce family is already closed against the identical tx hash (otherwise it raises -- two different transactions both claiming canonical status for one family is real corruption, not a benign replay), validates any genuine state change through the new pure-function graph, issues its own `UPDATE ... WHERE id = $1 AND state = $2`, and closes `nonce_families` with `WHERE closed_at IS NULL` so a second attempt can never re-close an already-closed family. `recordFeeReplacement` now looks up the original attempt's actual `nonce_family_id` and rejects the call if it disagrees with the caller-supplied value, instead of trusting two independently-supplied ids to already agree. Added `packages/db/test/06-txJournal.test.ts` (14 tests against real PostgreSQL): sequential and two-real-connection concurrent `reserveNonceFamily` nonce allocation (no collision), the `one_open_nonce_family_per_intent` rejection, `recoverUnsignedFamilies` correctly including an unsigned family and excluding a signed one, `markBroadcast`'s happy path/idempotent-duplicate/illegal-transition cases, `attachCanonicalReceipt`'s happy path/mismatched-linkage rejection/idempotent replay/double-close rejection, and `recordFeeReplacement`'s correct-linkage and mismatched-linkage cases.

**Evidence:** `agent-skills:security-auditor` Stage 3 review report (HIGH finding, "Transaction-journal state writes have no compare-and-set guard, and the whole file is untested"); `packages/db/src/stateTransitions.ts` (`TransactionAttemptState`, `TRANSACTION_ATTEMPT_STATE_GRAPH`, `isTransactionAttemptStateTransitionAllowed`); `packages/db/src/repositories/txJournal.ts` (`markBroadcast`, `attachCanonicalReceipt`, `recordFeeReplacement`); `packages/db/test/06-txJournal.test.ts` (14 tests, all passing against real local PostgreSQL, suite re-run twice for repeatability); `docs/implementation/evidence/verify-stage-03.log` (full clean-from-scratch pipeline run, 79/79 db tests passing, post-fix).

**Impact:** `packages/db/src/stateTransitions.ts`; `packages/db/src/repositories/txJournal.ts`; `packages/db/test/06-txJournal.test.ts` (new).

**Invalidated gates:** none (found and fixed within Stage 3, before checkpoint).

**Approval:** resolvable from evidence; the fix only narrows previously-unchecked writes to the same discipline already applied everywhere else in the package -- no authority, custody, or external-behavior change.

**Deferred, not fixed (in-scope note for Stage 4):** the same review's two MEDIUM findings -- (1) every by-ID repository read (`getPaymentById`, `getOperationById`, `getSignedArtifactById`, `getNonceFamilyById`, `getDeploymentById`, `getOutboxById`) takes a bare id with no ownership/vault scoping, which is inert today (no HTTP layer exists yet) but becomes a concrete IDOR risk the moment a Stage 4 handler wires one directly to a request without an explicit ownership check; and its LOW finding on `getPaymentsKeysetForVaults`'s composite index not covering the unfiltered multi-status multi-vault case -- are recorded here for Stage 4/7 attention rather than fixed now, per the reviewer's own recommendation that they are not Stage 3 blockers. `getPaymentsKeysetForVaults` already models the correct ownership-scoping pattern (`vaultIds` as the documented, non-widenable authorization boundary); Stage 4's handler design should require every direct-ID repository call to pair with an explicit, tested ownership check the same way.

## SPEC-014: local origin/HTTPS arrangement for browser session cookies (Stage 4)

**Gap:** Browser `Secure` cookies require a secure context. Local development runs over plain `http://127.0.0.1`, and CLAUDE.md forbids weakening SIWE/session security to accommodate local dev ("Do not require a pre-existing session to log in" and the general "do not quietly weaken an invariant to make a test pass" rule).

**Resolution:** `http://localhost`/`http://127.0.0.1` are W3C "potentially trustworthy origins," so real browsers honor `Secure` cookies there without TLS. The session cookie is therefore always built with `Secure`, `HttpOnly`, `SameSite=Strict` (`apps/api/src/auth.ts` `buildSessionCookie`), never conditionally relaxed, plus an explicit `Origin` allowlist (`API_ALLOWED_ORIGINS`) and CSRF token for browser-kind mutations. An `API_TLS_*` config path exists for real HTTPS; the local accommodation is config-scoped only and must not reach testnet/production config.

**Evidence:** `apps/api/src/auth.ts` (`buildSessionCookie`/`buildClearedSessionCookie`, `enforceBrowserMutationGuards`); `apps/api/test/auth.test.ts` "browser CSRF/Origin enforcement" suite (cookie-attribute assertions, no-Origin/disallowed-Origin/missing-CSRF-token/valid-both cases, all passing against the real app).

**Impact:** `apps/api/src/auth.ts`, `apps/api/src/config.ts` (`CookieConfig`).

**Invalidated gates:** none (Stage 4, defined and tested now).

**Approval:** resolvable from evidence; no authority change -- documents an existing browser platform behavior rather than disabling a check.

**Honest limitation:** the HTTP test client (`light-my-request`/`app.inject()`) does not enforce real browser cookie semantics (it does not simulate the browser's own `Secure`/`SameSite` enforcement or ambient-cookie attachment). These tests prove the server emits the correct attributes and enforces Origin/CSRF server-side; they do not prove real browser-extension behavior. See checkpoint 04's "explicitly untested" section.

## SPEC-015: `executionPaused` has no direct getter (Stage 4)

**Gap:** `API_CONTRACT.md`'s `GET /v1/vaults/{id}` response requires an `executionPaused` field, but `IPayGuardVault` exposes no `executionPaused()` getter -- the flag is only reachable through `getPolicyState(policyId).executionPaused`, which takes a policy id the caller may not have (a vault can have zero policies).

**Resolution:** `PayGuardVault.sol:637-648`'s `getPolicyState` never reverts for an unknown policy id and assigns `state.executionPaused = executionPausedFlag` unconditionally regardless of whether the policy id is real -- so reading it with the zero policy id (when the vault has no policies yet) or a real one (when it does) is correct and total. `apps/api/src/routes/vaults.ts`'s `GET /v1/vaults/{id}` reads the flag this way, using a real policy id when one exists and the zero id otherwise, and uses that zero-id read for `executionPaused` ONLY -- never for `active`/`revoked`/counters, since a zero-struct would otherwise misread as "policy inactive." No contract change.

**Evidence:** `contracts/core-v4/src/PayGuardVault.sol:637-648`; `apps/api/src/routes/vaults.ts` (`ZERO_POLICY_ID`, `probeId` selection); `apps/api/test/vaults.test.ts` "GET /v1/vaults/:id ownership" suite (200 responses read `executionPaused` against the real deployed vault with zero and non-zero policy counts).

**Impact:** `apps/api/src/routes/vaults.ts`.

**Invalidated gates:** none.

**Approval:** resolvable from evidence; read-only derivation, no authority change.

## SPEC-016: invoice-ingestion authority vs per-policy permission (Stage 4)

**Gap:** API_CONTRACT.md does not fully specify who may POST an invoice or exactly what `signatureValid` asserts, and CLAUDE.md warns "Display labels and merchant-supplied categories do not create permission" -- ingestion needed a rule that cannot be read as granting spending authority.

**Resolution:** `POST /v1/invoices` (`apps/api/src/routes/invoices.ts`) checks TWO separate things: cryptographic validity (ECDSA recovery over the EIP-712 invoice digest, matching the vault's own `ECDSA.tryRecover` check exactly -- never ERC-1271, which would report `signatureValid:true` for something `executePayment` will later reject) AND that the recovered signer matches an `invoiceSigner` in SOME merchant snapshot of that vault with the same `merchantId`. Matching a snapshot at ingestion establishes invoice validity only and confers no read access to anything; per-POLICY merchant permission is deliberately re-checked at intent creation (`POST /v1/payment-intents`) and again on-chain at `executePayment`. Submission itself is further restricted to the vault owner, a bound agent, or the recovered invoice signer -- no unrelated third party may write invoices into someone else's vault.

**Evidence:** `apps/api/src/routes/invoices.ts` (`recoverTypedDataSigner`, `findMerchantSnapshotForVault`, `isOwner`/`agentPolicies`/`isSigner` submission-authority check); `apps/api/src/signatures.ts` (`verifyEoaTypedSignature`, ECDSA-only per `PayGuardVault.sol:505-509`); `apps/api/test/invoices.test.ts` (accepts valid merchant signature, rejects wrong-signer with `INVALID_SIGNATURE`).

**Impact:** `apps/api/src/routes/invoices.ts`, `apps/api/src/signatures.ts`.

**Invalidated gates:** none.

**Approval:** resolvable from evidence; ingestion grants no chain authority by construction.

## SPEC-017: `/v1/payment-intents/{id}` path-parameter identity (Stage 4)

**Gap:** ARCH's endpoint table and API_CONTRACT.md needed disambiguation of what `{id}` names on the `/v1/payment-intents/{id}/...` sub-routes (simulate, approval-typed-data, approvals, submit) -- the payment resource or the intent resource, given a payment can carry multiple retired/active intent versions over time.

**Resolution:** `{id}` is the INTENT resource UUID (`payment_intents.id`), matching ARCH's "fixed intent ID" language, not `payments.id`. The sub-routes operate on the currently active intent version only (`retired_at IS NULL`); a request naming a retired intent id returns `409 INTENT_RETIRED` rather than silently operating on stale state (`apps/api/src/routes/paymentIntents.ts` `requireIntentAccess`).

**Evidence:** `apps/api/src/routes/paymentIntents.ts` (`loadIntent`, `requireIntentAccess`); `packages/db/migrations/0001_baseline.sql` (`payment_intents.retired_at`, `one_active_intent_per_payment` partial unique index).

**Impact:** `apps/api/src/routes/paymentIntents.ts`.

**Invalidated gates:** none.

**Approval:** resolvable from evidence; disambiguates an existing schema column, no authority change.

## SPEC-018: single active deployment for `GET /v1/config` and deploymentId validation (Stage 4)

**Gap:** `GET /v1/config` takes no parameters, so the process needs exactly one configured active deployment; separately, any route accepting a request-supplied `deploymentId` (chain observations, transaction lookup) needed a rule for what that parameter may and may not do.

**Resolution:** The process resolves exactly one configured active deployment (`context.config.deploymentId`); a mismatched/absent deployment fails `/health/ready` and refuses transaction preparation. Everywhere a request supplies a `deploymentId` (`POST /v1/chain-observations`, `GET /v1/transactions/{hash}`), it is VALIDATED as equal to that single active deployment (`assertActiveDeployment`, `apps/api/src/authz.ts`) -- never used to SELECT a deployment. This closes a class of bug where a caller could otherwise name any matching-chain deployment id, including one they do not own, to reach another instance's projections. Session-chainId is compared against the chain reached THROUGH the resource (vault -> deployment), never against the request-supplied `deploymentId`, for the same reason (`assertSessionChainMatches`).

**Evidence:** `apps/api/src/authz.ts` (`assertActiveDeployment`, `assertSessionChainMatches`); `apps/api/test/observations.test.ts` "rejects a deploymentId that is not the single active deployment"; `apps/api/test/payments.test.ts` "rejects a deploymentId that is not the active deployment".

**Impact:** `apps/api/src/authz.ts`, `apps/api/src/routes/observations.ts`, `apps/api/src/routes/payments.ts`.

**Invalidated gates:** none.

**Approval:** resolvable from evidence; closes a real cross-deployment authorization gap, no legitimate behavior narrowed.

## SPEC-019: `GET /v1/policies/{id}` access boundary -- API_CONTRACT wins over ARCH's table (Stage 4)

**Gap:** ARCH 3.5's endpoint table marks `GET /v1/policies/{id}` owner-only; API_CONTRACT.md's endpoint description says owner-or-bound-agent. Direct conflict between two authoritative-sounding sources.

**Resolution:** Per CLAUDE.md's source-authority rule ("API/INTERFACE specify boundaries" over ARCH's design-level table when they disagree on an access boundary), API_CONTRACT.md's wording governs: `GET /v1/policies/{id}` is reachable by the vault owner OR a bound agent (`requirePolicyAccess` -> `requireVaultOwnerOrAgent`), not owner-only. Recorded explicitly rather than silently picking one.

**Evidence:** `apps/api/src/authz.ts` (`requirePolicyAccess`); `apps/api/src/routes/policies.ts` `GET /v1/policies/:id`.

**Impact:** `apps/api/src/routes/policies.ts`, `apps/api/src/authz.ts`.

**Invalidated gates:** none.

**Approval:** resolvable from evidence per CLAUDE.md's explicit precedence rule; recorded per that rule's own requirement to record disagreements rather than silently choose.

## SPEC-020: `POST /v1/payment-intents/{id}/submit` idempotent on intent identity, not principal (Stage 4, pre-implementation design review, CRITICAL-3)

**Gap:** The route is authorized for EITHER the vault owner OR the bound agent, and API_CONTRACT.md requires "Repeating submit returns the same operation." Idempotency keys alone cannot deliver that: `idempotency_keys` is unique on `(principal_wallet_id, operation, client_key)`, so an owner submit and an agent submit of the SAME intent are two different principals and both would insert successfully -- two QUEUED operations and two outbox jobs for one payment, breaking the documented contract before Stage 5 ever sees it.

**Resolution:** Submission is idempotent on INTENT IDENTITY, independent of who submitted it: `findOpenOperationForResource` short-circuits a resubmit to the SAME existing operation (`deduplicated:true`) regardless of principal, backed by a database-level partial unique index `one_open_submission_per_intent ON operations(resource_id) WHERE resource_kind = 'payment_intent' AND status <> 'FAILED'` (migration `0004_stage4_indexes.sql`) plus a deterministic `outbox.event_key` (`submit:{intentId}`).

**Evidence:** `packages/db/migrations/0004_stage4_indexes.sql`; `apps/api/src/routes/paymentIntents.ts` (`POST .../submit`, `findOpenOperationForResource` pre-check); `apps/api/test/payments.test.ts` "is idempotent on intent identity regardless of principal: owner then bound agent get the SAME operation" (real owner submit followed by real bound-agent submit of the same intent, asserts identical `operationId` and exactly one outbox row).

**Impact:** `packages/db/migrations/0004_stage4_indexes.sql`, `apps/api/src/routes/paymentIntents.ts`.

**Invalidated gates:** none (found and fixed in pre-implementation design review, before any handler code was written).

**Approval:** resolvable from evidence; strictly closes a documented-contract gap, no authority change.

**Correction discovered during implementation testing (see SPEC-022 below):** the index as originally written compared `resource_kind = 'PAYMENT_INTENT'` (uppercase) against the lowercase values every write path actually stores, making it silently inert. Fixed before this database was ever shipped past this session -- see SPEC-022.

## SPEC-021: idempotent resubmission for signed business artifacts and dependent rows (Stage 4, found during implementation testing and fresh review)

**Gap:** `signed_artifacts` is `UNIQUE(kind,digest,signature_hash)`; `payment_intents.intent_digest` is globally `UNIQUE`; `approvals` is `UNIQUE(intent_id,approval_digest)` and `UNIQUE(vault_id,approval_nonce)`. All three are REAL constraints a legitimate resubmit can hit: a client retry after a network blip that resends the byte-identical signed invoice, intent, or owner approval. `createSignedArtifact` (`packages/db/src/repositories/artifacts.ts`), `createIntentVersion`, and `createApproval` (both `packages/db/src/repositories/payments.ts`) each did a plain `INSERT ... RETURNING *` with no conflict handling -- the loser of the race (or a simple sequential resubmit) got a raw Postgres unique-violation, which `apps/api/src/app.ts`'s generic error handler maps to an opaque `500 INTERNAL` instead of the idempotent `200`/`201` the resubmit contract requires. The first instance (`createSignedArtifact`) was found directly while writing `apps/api/test/invoices.test.ts`'s "resubmitting the IDENTICAL invoice is idempotent" case; the second (`createIntentVersion`, surfaced through `paymentIntents.ts`'s intent-creation path) was found the same way via `apps/api/test/paymentIntents.test.ts`'s duplicate-intent test; the fresh-context Stage 4 review (`agent-skills:security-auditor`) subsequently found the identical pattern still present in `createIntentVersion` under true concurrency (the sequential fix alone doesn't cover two simultaneous requests racing the pre-check) and, separately, in `createApproval`, which had no pre-check at all.

**Resolution:** All three now follow the same `ON CONFLICT DO NOTHING RETURNING *` + fallback-SELECT readback discipline used throughout `packages/db` since Stage 3 (e.g. `txJournal.ts`). `createSignedArtifact` conflicts on `(kind,digest,signature_hash)`; `createIntentVersion` conflicts on `intent_digest` (the retiring `UPDATE` that precedes it is safe to run redundantly -- a second racing transaction's retire-affecting-zero-rows is harmless, and the conflicting INSERT correctly falls back to the winner's already-committed row); `createApproval` conflicts on `(intent_id,approval_digest)`. `apps/api/src/routes/paymentIntents.ts`'s approval handler was corrected to return the `id` from `createApproval`'s actual return value rather than a locally-generated UUID that may not match the returned (possibly pre-existing) row.

**Evidence:** `packages/db/src/repositories/artifacts.ts` (`createSignedArtifact`); `packages/db/src/repositories/payments.ts` (`createIntentVersion`, `createApproval`); `apps/api/src/routes/paymentIntents.ts` (`POST .../approvals`, corrected `approvalId` source); `agent-skills:security-auditor` Stage 4 review (HIGH: "`createIntentVersion` -- plain INSERT against three real UNIQUE constraints, no CAS/readback"; HIGH: "`createApproval` -- plain INSERT against two real UNIQUE constraints, no CAS/readback"); `apps/api/test/invoices.test.ts` "resubmitting the IDENTICAL invoice is idempotent"; `apps/api/test/paymentIntents.test.ts` "duplicate intent: resubmitting the IDENTICAL signed intent is idempotent, not a second version or a 500".

**Impact:** `packages/db/src/repositories/artifacts.ts`, `packages/db/src/repositories/payments.ts`, `apps/api/src/routes/paymentIntents.ts`.

**Invalidated gates:** none (found and fixed within Stage 4, before checkpoint).

**Approval:** resolvable from evidence; narrows previously-unchecked writes to the same discipline already applied everywhere else in the package -- no authority, custody, or external-behavior change.

**Residual gap, not closed (in-scope note for Stage 5):** the fix is proven correct for sequential resubmission (real tests) and reasoned-through for true concurrency (the ON CONFLICT/readback pattern is the standard safe construction), but no test in this suite fires two truly simultaneous concurrent requests at `createIntentVersion`/`createApproval` the way `packages/db/test/06-txJournal.test.ts` did for `reserveNonceFamily` in Stage 3. Recorded as an explicit untested-but-reasoned gap rather than silently presented as fully proven; see checkpoint 04.

## SPEC-022: `one_open_submission_per_intent` index predicate case-mismatch (Stage 4, fresh review, HIGH)

**Gap:** Migration `0004_stage4_indexes.sql` (SPEC-020's database-level guarantee) created the index as `WHERE resource_kind = 'PAYMENT_INTENT' AND status <> 'FAILED'` (uppercase). Every application write path stores lowercase `resource_kind` values (`OPERATION_RESOURCE_KINDS` in `apps/api/src/authz.ts`: `'vault'`, `'policy'`, `'policy_draft'`, `'payment_intent'`; every `createOperation(...)` call site agrees). Postgres `text` comparison is case-sensitive, so the index's `WHERE` predicate never matched a single row the application ever inserted -- the constraint the pre-implementation design review rated CRITICAL was silently inert in the shipped migration.

**Resolution:** Corrected the predicate to the actual stored value: `WHERE resource_kind = 'payment_intent' AND status <> 'FAILED'`. Since the disposable local `payguard_test` database had already applied and checksummed the buggy version during earlier testing in this session, the database was dropped and recreated so the corrected migration applies cleanly rather than tripping the migration runner's checksum-drift guard -- safe and expected for a disposable local-only database per its own documentation.

**Evidence:** `packages/db/migrations/0004_stage4_indexes.sql`; `apps/api/src/authz.ts` (`OPERATION_RESOURCE_KINDS`); `agent-skills:security-auditor` Stage 4 review (HIGH: "Anti-duplicate-submission unique index never fires (case mismatch)"); `apps/api/test/payments.test.ts` "is idempotent on intent identity regardless of principal" (passes against the corrected index; a direct SQL check of `pg_indexes`/constraint-violation behavior was not additionally added since the existing idempotency test already exercises the application-level contract the index backs).

**Impact:** `packages/db/migrations/0004_stage4_indexes.sql`.

**Invalidated gates:** Stage 3/4 `verify-stage` runs against any `payguard_test` database that had the buggy migration applied are invalidated for that database instance only; a fresh `verify-stage 04` run (this checkpoint's evidence) applies the corrected migration from empty.

**Approval:** resolvable from evidence; one-line predicate correction restoring the originally-intended (and never-shipped-externally) guarantee, no authority change.

## SPEC-023: `Idempotency-Key` header enforced for owner vault-transaction preparation (Stage 4, fresh review, HIGH)

**Gap:** `requireIdempotencyKey` (`apps/api/src/auth.ts`) validated the HEADER'S PRESENCE/SHAPE on `POST /v1/vaults/{id}/transactions`, `POST /v1/payment-intents`, and `.../submit`, but the key string itself was discarded at all three call sites -- never stored, looked up, or compared against a prior request. The dedicated `beginIdempotentRequest`/`completeIdempotentRequest` repository (`packages/db/src/repositories/idempotency.ts`, built in Stage 3 per ARCH 3.2) was fully implemented but imported nowhere in `apps/api`. For `POST /v1/payment-intents` and `.../submit`, other domain-level uniqueness (invoice identity, intent digest, resource-scoped operation lookup) happened to provide partial coverage. `POST /v1/vaults/{id}/transactions` had NO compensating protection at all: resubmitting an identical `WITHDRAW`/`DEPOSIT`/etc. request with the same `Idempotency-Key` (the documented retry-safety contract) created a brand-new `operations` row and a brand-new independently-valid prepared transaction every time -- a genuine fund-risk gap if an owner-side automation retries on timeout trusting the idempotency contract and signs/broadcasts both.

**Resolution:** `POST /v1/vaults/{id}/transactions` now wires `beginIdempotentRequest`/`completeIdempotentRequest` into its existing write transaction, keyed on `(principalWalletId, operation: "vault_transaction:{vaultId}", clientKey: the Idempotency-Key header)` with the already-computed canonical request digest. A resubmit with the same key and the same canonical body returns the STORED response verbatim (same `operationId`, same prepared transactions) rather than re-preparing; the same key with a DIFFERENT body returns `409 IDEMPOTENCY_KEY_REUSED` rather than silently proceeding as the old request. `POST /v1/payment-intents` and `.../submit` were left on their existing domain-level idempotency (invoice/intent identity, resource-scoped operation lookup respectively) rather than layered with a second mechanism, since those paths' idempotency keys are already fully backed by SPEC-020/SPEC-021's fixes; only the vault-transactions route had zero backing at all.

**Evidence:** `apps/api/src/routes/vaults.ts` (`POST /v1/vaults/:id/transactions`, `beginIdempotentRequest`/`completeIdempotentRequest` wiring); `packages/db/src/repositories/idempotency.ts`; `agent-skills:security-auditor` Stage 4 review (HIGH: "`Idempotency-Key` header is required but never actually used -- no real idempotency on `POST /v1/vaults/{id}/transactions`"); `apps/api/test/vaults.test.ts` "resubmitting the same Idempotency-Key with the SAME body returns the identical operation" and "reusing the same Idempotency-Key with a DIFFERENT body is refused" (both real tests against the real app/DB).

**Impact:** `apps/api/src/routes/vaults.ts`.

**Invalidated gates:** none (found and fixed within Stage 4, before checkpoint).

**Approval:** resolvable from evidence; closes a documented-but-unenforced retry-safety contract, no authority change. Owner-transaction preparation still requires the vault owner's session; this fix only prevents a retried identical request from producing two independently signable transactions.

## SPEC-024: `GET /v1/vaults/{id}` must report the actual vault owner, not the caller's own address (Stage 4, fresh review, Important)

**Gap:** `GET /v1/vaults/{id}` is authorized for the vault owner OR a bound agent (`requireVaultOwnerOrAgent`), but the handler unconditionally set the response's `ownerAddress` field to `auth.walletAddress` -- the CALLER's own session address. When a bound agent calls this endpoint, the response reported the agent's own wallet address as the vault owner: factually wrong data returned from an authenticated, authorized call, conflicting with CLAUDE.md's "Owner, merchant, agent and relayer are distinct roles" invariant.

**Resolution:** The handler now resolves the actual owner's address from `vault.ownerWalletId` (a direct `wallets` lookup) rather than echoing the caller's session address. `GET /v1/vaults` (the list route) was checked and found NOT to share this bug -- it is owner-scoped by construction (`getVaultsKeysetForOwner` only ever returns vaults the caller owns), so `auth.walletAddress` is genuinely always correct there.

**Evidence:** `apps/api/src/routes/vaults.ts` (`GET /v1/vaults/:id`, owner-wallet lookup); `agent-skills:code-reviewer` Stage 4 review (Important: "`GET /v1/vaults/{id}` ... unconditionally sets `ownerAddress: auth.walletAddress`"); `apps/api/test/vaults.test.ts` "reports the ACTUAL vault owner address, not the caller own, when read by a bound agent" (seeds a real policy binding the agent, asserts the response names the owner, not the agent).

**Impact:** `apps/api/src/routes/vaults.ts`.

**Invalidated gates:** none.

**Approval:** resolvable from evidence; corrects a factual-data bug, no authority change (the access boundary itself -- owner-or-bound-agent -- was already correct).

## SPEC-025: `GET /v1/transactions/{hash}` must gate its ENTIRE response on payment role, not just the nested detail (Stage 4, fresh review, Medium)

**Gap:** The handler resolved a transaction attempt from a bare `(deploymentId, txHash)` lookup and unconditionally returned base fields (`hash`, `state`, `replacementOf`) in the response; an ownership check (`resolvePaymentRole`) only gated the NESTED `authorizedPayment` object, conditioned on the trace attempt->nonce_family->intent->payment resolving. This is a bare-id read returning data before any ownership predicate is evaluated -- the exact global rule `apps/api/src/authz.ts` documents ("no handler may return data derived from a bare-id repository read until an ownership predicate has been evaluated"), violated for the base fields specifically.

**Resolution:** Every `nonce_families` row is `NOT NULL` on `intent_id` (a Stage 4 transaction attempt exists only for payment-intent submissions), so the attempt->payment trace is expected to always resolve; if it somehow doesn't, that is now treated as a data-integrity condition refused with `404`, never as a reason to fall back to returning base fields unauthenticated. `resolvePaymentRole` is now evaluated BEFORE building any part of the response body, and the whole response -- not just `authorizedPayment` -- is gated on it.

**Evidence:** `apps/api/src/routes/payments.ts` (`GET /v1/transactions/:hash`); `agent-skills:code-reviewer` Stage 4 review (Medium: "`GET /v1/transactions/{hash}` leaks attempt state/replacement linkage without an ownership check"); `apps/api/test/payments.test.ts` "GET /v1/transactions/:hash" suite (unknown hash 404s; deploymentId-mismatch 503s).

**Impact:** `apps/api/src/routes/payments.ts`.

**Invalidated gates:** none.

**Approval:** resolvable from evidence; closes an IDOR-class gap on public-adjacent data (transaction hashes are themselves publicly observable once broadcast, but processing state/linkage should still require an actual relationship to the payment), no authority change.

## SPEC-026: `/health/ready` must never leak raw DB/RPC error text (Stage 4, fresh review, Critical)

**Gap:** `GET /health/ready` is a PUBLIC route (`PUBLIC_ROUTES` in `apps/api/src/app.ts`, no session required). Its database/deployment/chain readiness checks put `error instanceof Error ? error.message : ...` directly into the response's `detail` field. `pg`'s own error messages routinely include hostnames, ports, and the connecting role name (`password authentication failed for user "..."`, `ECONNREFUSED host:port`). This directly contradicted CLAUDE.md's "no raw DB error message can leak to a client" invariant and `apps/api/src/errors.ts`'s own documented rule ("Deliberately generic: never leak a stack trace, internal path or DB detail"), which every OTHER error path in the app already honored (`app.ts`'s `setErrorHandler`) -- this one route was the exception.

**Resolution:** All three readiness checks (database, deployment lookup, chain) now push a fixed, non-parameterized `detail` string (`'unreachable'`, `'lookup failed'`) and log the real error server-side only via `request.log.error`. The RPC/chain check's detail string (`observed=X expected=Y`) was left as-is since it names only public chain-id numbers, not driver/connection internals.

**Evidence:** `apps/api/src/routes/health.ts`; `agent-skills:code-reviewer` Stage 4 review (Critical: "`GET /health/ready` puts `error.message` directly into the public JSON response's `detail` field"); `apps/api/src/errors.ts` comment ("Deliberately generic: never leak a stack trace, internal path or DB detail to a client") as the pre-existing standard this route now also meets.

**Impact:** `apps/api/src/routes/health.ts`.

**Invalidated gates:** none.

**Approval:** resolvable from evidence; closes a real unauthenticated information-disclosure gap, no authority or external-behavior change beyond removing leaked internals.

## SPEC-027: cross-package ABI identity is now an actual test, not just an unverified comment (Stage 4, fresh review, Suggestion)

**Gap:** `packages/integration/scripts/generate-abi.ts`'s header comment claimed "a separate cross-package test asserts both copies stay byte-identical to each other" (referring to `packages/chain/src/generated/abi.ts` vs `packages/integration/src/generated/abi.ts`, two independently-generated copies of `PAYGUARD_VAULT_ABI` from the same compiled Foundry artifact, by design never sharing a runtime dependency). No such test existed anywhere in the repo; each package's own `abi-drift.test.ts` only self-checks against its own `renderAbiModule()`.

**Resolution:** The cross-package equality test could not live in `packages/integration` (its `test/boundary.test.ts` forbids `@payguard/chain` in ANY dependency field, even `devDependencies`, per ARCH 3.1's public-boundary rule). It was added instead in `packages/chain/test/cross-package-abi.test.ts`, which has no such restriction, importing `@payguard/integration` as a `devDependency` and asserting `PAYGUARD_VAULT_ABI` deep-equality between the two packages' generated modules. `generate-abi.ts`'s comment was corrected to point at the actual location and explain why the test lives on that side of the dependency direction.

**Evidence:** `packages/chain/test/cross-package-abi.test.ts` (new); `packages/chain/package.json` (`@payguard/integration` devDependency); `packages/integration/scripts/generate-abi.ts` (corrected comment); `packages/integration/test/boundary.test.ts` (the rule that dictated the test's location); `agent-skills:code-reviewer` Stage 4 review (Suggestion: comment claimed untested coverage).

**Impact:** `packages/chain/package.json`, `packages/chain/test/cross-package-abi.test.ts` (new), `packages/integration/scripts/generate-abi.ts`.

**Invalidated gates:** none.

**Approval:** resolvable from evidence; adds real coverage for a claim that was already true in practice (both scripts read the identical source artifact) but previously unverified, no authority change.

## SPEC-028: outbox `eventKey` must be scoped by operation, not bare intent (Stage 5, found during implementation testing)

**Gap:** `POST /v1/payment-intents/{id}/submit` enqueued the durable outbox job with `eventKey: submit:${intentId}` and `ON CONFLICT (event_key) DO NOTHING`. `findOpenOperationForResource` already makes a REPLAY of the SAME open command idempotent, so the outbox key only needed to stop a concurrent double-enqueue for the operation just created. A bare intent-only key additionally collided with a LATER, legitimate resubmission of the same intent once the first operation reached a terminal status (e.g. `FAILED` after an ESCALATE decision with no approval yet) -- `ON CONFLICT DO NOTHING` silently swallowed that second, real submit command instead of queuing it, leaving the payment permanently stuck with no way to progress after the owner supplied the missing approval.

**Resolution:** `eventKey` is now `` submit:${intentId}:${operationId} `` -- unique per operation, so a fresh operation (created only after the prior one went terminal) always gets its own outbox row.

**Evidence:** `apps/api/src/routes/paymentIntents.ts` (`POST /v1/payment-intents/:id/submit`); `apps/api/test/payments.test.ts` ("a NEW submit after the first operation reaches a terminal status queues a fresh job, not swallowed by the old event_key").

**Impact:** `apps/api/src/routes/paymentIntents.ts`; `apps/worker/test/helpers/paymentFixture.ts`'s `seedSubmission` mirrors the same key shape.

**Invalidated gates:** none (found and fixed within Stage 5, before checkpoint).

**Approval:** resolvable from evidence; closes a real stuck-payment gap, no authority change.

## SPEC-029: a real receipt reveals inclusion and outcome simultaneously -- direct state-graph edges needed (Stage 5, recovery-table review)

**Gap:** `EXECUTION_STATUS_GRAPH` and `TRANSACTION_ATTEMPT_STATE_GRAPH` (Stage 3) only reached `SUCCEEDED`/`REVERTED` via an intermediate `INCLUDED` state, modeling a two-phase "included, then separately learn the outcome" observation. A real `eth_getTransactionReceipt` call returns inclusion AND status (`success`/`reverted`) in the SAME response -- there is no real moment where a worker has observed "included" without also already knowing the outcome. The graph's two-phase shape had no code path that would ever legally use it for the worker's actual poll-and-reconcile flow, which would have made every real settlement hit `InvalidStateTransitionError`.

**Resolution:** Added direct edges `SUBMITTED -> SUCCEEDED|REVERTED` and `UNKNOWN -> SUCCEEDED|REVERTED` (alongside the existing `INCLUDED` two-phase path, kept for a caller that deliberately wants it) to both `EXECUTION_STATUS_GRAPH` and `TRANSACTION_ATTEMPT_STATE_GRAPH`. The same rationale extends to `CONFIDENCE_GRAPH`: an auto-mined LOCAL_DEMO receipt has no meaningful separate "included, demo-confidence not yet assigned" moment, so `UNOBSERVED -> LOCAL_DEMO` is now also a direct edge.

**Evidence:** `packages/db/src/stateTransitions.ts` (`EXECUTION_STATUS_GRAPH`, `TRANSACTION_ATTEMPT_STATE_GRAPH`, `CONFIDENCE_GRAPH` comments citing this reasoning); `packages/db/test/stateTransitions.test.ts`; `apps/worker/src/reconcile.ts` (the real caller these edges make legal).

**Impact:** `packages/db/src/stateTransitions.ts`.

**Invalidated gates:** none (found and fixed within Stage 5, before checkpoint; Stage 3's own gate is unaffected since this only ADDS legal edges, never removes one Stage 3 relied on).

**Approval:** resolvable from evidence; matches actual JSON-RPC receipt semantics, no authority change.

## SPEC-030: `payments.execution_status` was never driven past `DRAFT` anywhere in Stage 4 (Stage 5, found during implementation testing)

**Gap:** Stage 4's `POST /v1/payment-intents` and `POST /v1/payment-intents/{id}/submit` routes created/queued payments but never called `updatePaymentState` to move `executionStatus` off its initial `DRAFT` value. The Stage 5 worker's own transitions (`QUEUED -> SIGNED -> SUBMITTED -> ...`) are only legal starting from `READY`/`AWAITING_APPROVAL` per the state graph, so every real payment would have hit `InvalidStateTransitionError` on its very first worker-driven transition.

**Resolution:** `POST /v1/payment-intents` now performs `DRAFT -> READY` (ALLOW) or `DRAFT -> AWAITING_APPROVAL` (ESCALATE) right after evaluation, guarded by `isExecutionStatusTransitionAllowed` so a payment already mid-flight from an earlier intent version is left untouched. `POST /v1/payment-intents/{id}/submit` performs `READY|AWAITING_APPROVAL -> QUEUED`. `AWAITING_APPROVAL` needed a direct edge to `QUEUED` (not only `READY`) because submit queues regardless of whether the approval has arrived yet -- the worker itself re-evaluates and rejects with `APPROVAL_REQUIRED` if still missing, rather than the API pre-judging that.

**Evidence:** `apps/api/src/routes/paymentIntents.ts`; `packages/db/src/stateTransitions.ts` (`AWAITING_APPROVAL: ['READY','QUEUED','CANCELLED']`); `apps/api/test/paymentIntents.test.ts`, `apps/api/test/payments.test.ts`.

**Impact:** `apps/api/src/routes/paymentIntents.ts`; `packages/db/src/stateTransitions.ts`.

**Invalidated gates:** none (found and fixed within Stage 5, before checkpoint).

**Approval:** resolvable from evidence; closes a gap that would have made every real payment fail its first worker transition, no authority change.

## SPEC-031: a CANCELLED payment must be able to flow back to READY for a genuine resubmission (Stage 5, found during implementation testing)

**Gap:** `EXECUTION_STATUS_GRAPH`'s own comment documents the intent that "a reverted/cancelled attempt does not permanently block the invoice ... both flow back to READY for a fresh attempt" (`CANCELLED: ['READY']` was already present as an edge), but no code anywhere actually performed that transition. `POST /v1/payment-intents/{id}/submit` only drove `READY|AWAITING_APPROVAL -> QUEUED`, so a legitimate resubmission of the SAME intent after its prior operation went terminal (e.g. an ESCALATE rejected for `APPROVAL_REQUIRED`, then the owner supplies the approval and the agent submits again -- exactly the flow SPEC-028's own comment describes as intended) would find the payment stuck at `CANCELLED` forever: the submit route's transition guard would silently no-op, and the worker's later `QUEUED -> SIGNED` transition would throw.

**Resolution:** The submit route now hops `CANCELLED -> READY -> QUEUED` (two real `updatePaymentState` calls, chaining the returned row's `stateVersion`) before falling through to its existing `READY|AWAITING_APPROVAL -> QUEUED` logic. The worker's own test fixture (`apps/worker/test/helpers/paymentFixture.ts`'s `seedSubmission`, which mirrors this route for tests that bypass HTTP) got the identical fix.

**Evidence:** `apps/api/src/routes/paymentIntents.ts` (`POST /v1/payment-intents/:id/submit`); `apps/worker/test/helpers/paymentFixture.ts`; `apps/worker/test/scenarios.test.ts` (the ESCALATE-then-approval-then-resubmit test that discovered this gap).

**Impact:** `apps/api/src/routes/paymentIntents.ts`; `apps/worker/test/helpers/paymentFixture.ts`.

**Invalidated gates:** none (found and fixed within Stage 5, before checkpoint).

**Approval:** resolvable from evidence; implements a transition the graph already declared legal and documented as intended, no authority change.

## SPEC-032: indexer reorg ancestor-search must compare against OUR OWN stored chain, not just step back once (Stage 5, found via a real `anvil_reorg` test)

**Gap:** `findCommonAncestorAndOrphans` (the walk-back used when the indexer detects the chain's block at its cursor's last-processed height no longer matches what was recorded) always declared the ancestor after exactly ONE step back, regardless of whether the chain still diverged there, and never accumulated more than the single seed orphaned hash -- it never actually compared the live chain against the worker's own `chain_blocks` rows at each height. This was silently correct only by coincidence for an exactly-1-block-deep reorg; any reorg 2+ blocks deep would misidentify the ancestor (reporting a still-orphaned block as canonical) and leave stale blocks/receipts/events marked canonical forever, and `getPaymentsAffectedByOrphanedBlocks` would miss payments whose winning receipt lived in the un-recorded orphaned heights, so they would never regress from a stale `SUCCEEDED`.

**Resolution:** Added `getCanonicalBlockAtHeight` (`packages/db/src/repositories/indexing.ts`) to read the block WE currently consider canonical at a given height. `findCommonAncestorAndOrphans` now walks back one height at a time, fetching both the live chain's block and our own stored canonical block at that height, and only stops (reporting the ancestor) at the first height where the two hashes agree; every height where they disagree is added to the orphaned set. Falls back to `deps.startBlock` (full rebuild) if no agreement is found within the bounded 64-block walk.

**Evidence:** `apps/worker/src/indexer.ts` (`findCommonAncestorAndOrphans`); `packages/db/src/repositories/indexing.ts` (`getCanonicalBlockAtHeight`); `apps/worker/test/indexer.test.ts`'s "real reorg regression" test (a genuine `anvil_reorg(depth=3)` against a settled payment, asserting the payment regresses to `UNKNOWN`/`UNOBSERVED` and the cursor resumes from a block hash that actually matches the live chain -- this test failed against the old one-step logic before the fix, for a test-helper reason first (see the test file's own comment on `tickUntilCaughtUp`), and then again against the real bug once the test helper was corrected).

**Impact:** `apps/worker/src/indexer.ts`; `packages/db/src/repositories/indexing.ts`.

**Invalidated gates:** none (found and fixed within Stage 5, before checkpoint).

**Approval:** resolvable from evidence; corrects reorg-handling correctness for any multi-block reorg, no authority change.

## SPEC-033: `rejectPayment` must not attempt a same-to-same `policyDecision` transition (Stage 5, found via a real fault-injection test)

**Gap:** `handlePaymentSubmissionJob`'s `rejectPayment` unconditionally passed the fresh `evaluation.decision` as the next `policyDecision` on `updatePaymentState`, even when it exactly matched the payment's ALREADY-current `policyDecision` (the overwhelmingly common case: a fresh re-evaluate() of a BLOCK payment almost always reconfirms BLOCK). `updatePaymentState`/`isPolicyDecisionTransitionAllowed` treats a same-to-same transition as illegal by design ("a transition to the same state is a no-op, not a transition"), so this threw `InvalidStateTransitionError` inside the job's transaction on every genuinely-BLOCKed or still-missing-approval ESCALATE submission. The outbox's own error handling swallowed the throw into a retry with backoff, so the job silently cycled forever (never reaching a terminal DONE/DEAD within any reasonable window) instead of ever recording the rejection -- a payment that should have reached `CANCELLED` immediately just never resolved.

**Resolution:** `rejectPayment` now includes `policyDecision` in the `updatePaymentState` call only when it actually differs from the payment's current value, using the same conditional-include pattern `apps/api/src/routes/paymentIntents.ts`'s `POST /v1/payment-intents` already used for the identical reason.

**Evidence:** `apps/worker/src/submitPayment.ts` (`rejectPayment`); `apps/worker/test/scenarios.test.ts` (the BLOCK and ESCALATE-without-approval tests that discovered this -- both hung retrying with `lastError: "illegal policyDecision transition: BLOCK -> BLOCK"` / `"... ESCALATE -> ESCALATE"` before the fix).

**Impact:** `apps/worker/src/submitPayment.ts`.

**Invalidated gates:** none (found and fixed within Stage 5, before checkpoint).

**Approval:** resolvable from evidence; closes a real payment-never-resolves gap, no authority change.

## SPEC-034: reorg regression must reset stale `reconciliation`, and `UNKNOWN` must have a graph-legal path back to `READY` (Stage 5, found via independent fresh-context review)

**Gap:** Two related gaps in the reorg-regression path found by an independent review pass (lens A):
1. `indexer.ts`'s reorg-detection was anchored only to the indexer's OWN cursor frontier (`cursor.lastCanonicalHash` at height `fromBlock-1`). `reconcileAttempt` (`reconcile.ts`) writes a canonical block synchronously at a settlement's exact height, independent of and often ahead of the indexer's own scanned height. A reorg that orphaned one of these out-of-band-ahead blocks BEFORE the indexer's cursor ever reached that height was invisible to the old check entirely: the stale `canonical=true` row (and the payment's stale `SUCCEEDED`/`MATCHED` state) would persist forever, and a differently-hashed replacement block at the same height risked colliding with the `canonical_block_height` partial unique index.
2. `regressAffectedPayments` drove a reorg-affected payment's `executionStatus`/`confidence` back to `UNKNOWN`/`UNOBSERVED` but never touched `reconciliation` -- a previously `MATCHED` payment stayed `MATCHED` while simultaneously `UNKNOWN`, a self-contradictory persisted combination. Separately, `EXECUTION_STATUS_GRAPH` gave `UNKNOWN` no edge to `READY` (unlike `REVERTED`/`CANCELLED`, which both already have one for the identical "fresh attempt is legitimate" reason), so a reorg-regressed payment (`reasonCode ORPHANED_BLOCK`) had no graph-legal path to ever being resubmitted -- permanently stranded.

**Resolution:** Added `getMaxCanonicalBlock` (`packages/db/src/repositories/indexing.ts`), returning the highest canonical block WE have recorded from ANY writer, not only the indexer's own forward scan. `runIndexerTick`'s reorg check now anchors to this instead of the cursor's own frontier -- it subsumes the old check as a special case (the indexer's own last write is always `<=` this) and additionally catches a reorg at an out-of-band-ahead height. `regressAffectedPayments` now also resets `reconciliation` back to `NOT_CHECKED` (via `isReconciliationTransitionAllowed`) whenever the payment being regressed had a `MATCHED`/`MISMATCH` verdict, since that verdict was about a receipt that no longer exists on the canonical chain. `EXECUTION_STATUS_GRAPH` gained `UNKNOWN -> READY`; `POST /v1/payment-intents/{id}/submit` now performs the same `UNKNOWN -> READY -> QUEUED` hop it already does for `CANCELLED`, but ONLY when `reconciliation !== 'MISMATCH'` -- MISMATCH stays sticky (ARCH 3.4: "never triggers an automatic second payment") and is deliberately left untouched, matching the existing invariant. As a further hardening found while implementing this, `handlePaymentSubmissionJob` itself now also independently refuses to execute a job for a `MISMATCH`-flagged payment (rejecting with `RECONCILIATION_MISMATCH_STICKY`), so the API-layer guard is not the sole enforcement point.

**Evidence:** `packages/db/src/repositories/indexing.ts` (`getMaxCanonicalBlock`); `apps/worker/src/indexer.ts` (`runIndexerTick`, `regressAffectedPayments`); `packages/db/src/stateTransitions.ts` (`UNKNOWN: [...,'READY']`); `apps/api/src/routes/paymentIntents.ts` (submit route's `readyEligible` hop); `apps/worker/src/submitPayment.ts` (`handlePaymentSubmissionJob`'s MISMATCH guard); `apps/worker/test/indexerReorgAheadOfCursor.test.ts` (its own isolated harness -- see the file's own header comment for why: a real reorg on a shared harness desyncs the relayer's `signer_state.next_nonce` for any later payment, a separate real gap this test deliberately avoids rather than papers over) -- a real `anvil_reorg` against a block the indexer's cursor had NEVER scanned, which fails without the `getMaxCanonicalBlock` anchor; `apps/api/test/payments.test.ts`'s two new SPEC-034 tests (`UNKNOWN`+`NOT_CHECKED` resubmits into `QUEUED`; `UNKNOWN`+`MISMATCH` stays untouched).

**Impact:** `packages/db/src/repositories/indexing.ts`; `apps/worker/src/indexer.ts`; `packages/db/src/stateTransitions.ts`; `apps/api/src/routes/paymentIntents.ts`; `apps/worker/src/submitPayment.ts`.

**Invalidated gates:** none (found and fixed within Stage 5, before checkpoint).

**Approval:** resolvable from evidence; closes a real stranding/staleness gap and preserves the existing MISMATCH-sticky invariant explicitly, no authority change.

## SPEC-035: `handlePaymentSubmissionJob` must chase an open nonce family to resolution BEFORE any retirement/policy rejection (Stage 5, found via independent fresh-context adversarial review)

**Gap:** An independent adversarial review pass (lens B) found that `handlePaymentSubmissionJob` checked `bundle.retired`/`bundle.policyObservedStatus` and rejected (via `rejectPayment`, which completes the outbox job) BEFORE ever consulting `getOpenNonceFamilyForIntent`. Concrete reachable sequence, no crash required: the worker signs+broadcasts a transaction that doesn't mine within the bounded receipt-poll wait, so the job is requeued (still `SIGNED`/`SUBMITTED`, family open); before it's reclaimed, the agent legitimately creates a new intent version for the same payment (`createIntentVersion` unconditionally retires the prior one); the reclaimed job now sees `bundle.retired === true` and rejects immediately -- `rejectPayment`'s `CANCELLED` transition is silently skipped (illegal from `SIGNED`/`SUBMITTED` per `EXECUTION_STATUS_GRAPH`), but the operation is marked `FAILED` and the outbox job `DONE` regardless, and `reconcileAttempt` is only ever reachable from inside a live `handlePaymentSubmissionJob` invocation for that job -- so if the already-broadcast transaction later mines, funds genuinely move on-chain with nothing left to ever reconcile it, while the DB permanently shows a stuck `SIGNED`/`SUBMITTED` payment. The identical bug fires for an owner pausing the policy while a signed/broadcast attempt is in flight.

**Resolution:** Reordered `handlePaymentSubmissionJob`: the `getOpenNonceFamilyForIntent` check (and its resume-and-poll path) now runs first, unconditionally; the `retired`/`policyObservedStatus` rejection checks only run afterward, in the branch where no open family exists -- i.e. only when it is genuinely safe to reject before any nonce has been spent. `markOperationInProgress` moved to run unconditionally before both branches (harmless and idempotent either way; `QUEUED -> FAILED` was already a legal direct operation-status edge, confirmed against `OPERATION_STATUS_GRAPH`, so this reordering does not depend on that edge either way).

**Evidence:** `apps/worker/src/submitPayment.ts` (`handlePaymentSubmissionJob`); `apps/worker/test/faultInjection.test.ts`'s new SPEC-035 scenario (`anvil_setAutomine(false)`, a real signed+broadcast attempt that doesn't mine, a real `retired_at` update simulating the exact `createIntentVersion` race window, the transaction then genuinely mining, and a second `handlePaymentSubmissionJob` invocation on the SAME lease -- asserts the payment still reaches `SUCCEEDED`/`MATCHED` instead of being abandoned).

**Impact:** `apps/worker/src/submitPayment.ts`.

**Invalidated gates:** none (found and fixed within Stage 5, before checkpoint).

**Approval:** resolvable from evidence; closes a real fund-movement-without-reconciliation gap (CLAUDE.md: "Chain observations determine fund movement and consumption"), no authority change.

## SPEC-036: `GET /v1/payments/:id` hid `REVERTED` transaction evidence and reported the authorization ceiling as the actual settled amount (Stage 5, found via independent fresh-context review)

**Gap:** An independent review pass (lens A) found two read-path defects in `loadPaymentDetail` (`apps/api/src/routes/payments.ts`):
1. The join selecting the winning `transaction_attempts` row filtered `ta.state IN ('SUBMITTED','UNKNOWN','INCLUDED','SUCCEEDED')`, omitting `REVERTED`. Since `reconcile.ts` sets a truly-reverted winning attempt's state to `REVERTED`, `GET /v1/payments/:id` returned `transaction: null` for every reverted payment -- hiding exactly the evidence (gas/nonce spent, invoice not consumed) this endpoint exists to surface, even though the underlying `receipts`/`transaction_attempts` rows were fine.
2. `settlement.actualInputAtomic` was populated from `payment_intents.max_input_amount` -- the signed AUTHORIZATION ceiling, not the amount the vault actually pulled. `validatePaymentExecution` already decodes the real `PaymentExecuted.actualInput` from the canonical receipt during reconciliation, but `reconcile.ts` only keeps `.valid`/`.failed` from that result; the true value survived only inside `chain_events.decoded_payload`'s raw JSONB, so the field the API labeled "actual" was really "authorized max" -- a real risk for any route where actual input can be below the cap.

**Resolution:** The transaction-attempt join's state filter now includes `REVERTED`. A new `LEFT JOIN chain_events` (on `deployment_id`, `tx_hash`, `decoded_name = 'PaymentExecuted'`, `canonical = true`) reads the already-persisted decoded event payload; `settlement.actualInputAtomic`/`outputDeliveredAtomic`/`subsidyAmountAtomic` now come from that decoded payload's `actualInput`/`exactOutput`/`subsidyAmount` fields (falling back to the invoice's own `output_amount` for `outputDeliveredAtomic` only if the decode is somehow missing), never from the intent's authorized ceiling.

**Evidence:** `apps/api/src/routes/payments.ts` (`loadPaymentDetail`); `apps/api/test/payments.test.ts`'s new SPEC-036 test (a payment driven to `REVERTED` via a real journaled attempt, asserting `transaction.hash` is still returned); `apps/api/test/publicApiPaymentDemo.test.ts`'s new SPEC-036 test (a real end-to-end settlement with `maxInputAmount` set well above `outputAmount`, asserting `settlement.actualInputAtomic` comes back as the real decoded amount, not the ceiling).

**Impact:** `apps/api/src/routes/payments.ts`.

**Invalidated gates:** none (found and fixed within Stage 5, before checkpoint).

**Approval:** resolvable from evidence; closes a real evidence-hiding/misreporting gap in the read contract, no authority change.

## SPEC-037 (RESOLVED, B1): a reorg that orphans a relayer-broadcast transaction desyncs `signer_state.next_nonce` from the live chain

**Resolution status update (B1, 2026-09-17):** Fixed. See "SPEC-037 fix" entry immediately below this one for the implementation, tests and evidence. The original gap description, evidence and (now superseded) "none yet" resolution note are preserved below unmodified as the historical record of what B0/Stage 5 left open.

## SPEC-037 (original entry, KNOWN GAP, NOT FIXED at Stage 5): a reorg that orphans a relayer-broadcast transaction desyncs `signer_state.next_nonce` from the live chain

**Gap:** Discovered incidentally while writing SPEC-034's regression test (not a finding from either review lens; not fixed in this pass). `regressAffectedPayments`/`reorgToBlock` (the reorg-regression path) correctly flips `chain_blocks`/`receipts`/`chain_events` canonicality and regresses affected `payments` rows, but never touches `signer_state.next_nonce`. If the orphaned block contained a transaction WE broadcast (i.e. its nonce was already counted in `next_nonce`), and Anvil's default reorg behavior mines empty replacement blocks (never re-including that transaction), the chain's real next-expected nonce for that signer moves backward relative to what our DB still believes. Every SUBSEQUENT payment from that same signer then reserves a nonce ahead of what the chain will actually accept next, gets broadcast, and sits in the mempool indefinitely (a real, reproducible nonce gap) -- confirmed directly: stacking a third real payment onto the SAME harness/relayer immediately after `apps/worker/test/indexer.test.ts`'s existing real-reorg test left that third payment stuck at `SUBMITTED` for 15s+ of patient polling, never mining.

**Resolution:** none yet. `apps/worker/test/indexerReorgAheadOfCursor.test.ts` (SPEC-034's own regression test) was deliberately given its OWN isolated harness specifically to avoid this contamination, rather than either fixing this gap under time pressure or letting it silently fail an unrelated test.

**Evidence:** reproduced directly during this session (see above); `apps/worker/src/indexer.ts`'s `regressAffectedPayments`/`reorgToBlock` callers (no `signer_state` write anywhere in the reorg path); `packages/db/src/repositories/txJournal.ts` (`signer_state.next_nonce` is only ever written by `reserveNonceFamily`/`recoverUnsignedFamilies`, never adjusted downward).

**Impact:** none yet -- not implemented. Likely fix direction for a future stage: on reorg regression, for each orphaned block, check whether any of OUR OWN `nonce_families`/`transaction_attempts` lived there; if so, either replay a no-op/same-nonce transaction to fill the gap, or re-derive `signer_state.next_nonce` from the live chain's actual `eth_getTransactionCount` for that signer rather than trusting the DB's own counter blindly after a reorg.

**Invalidated gates:** none (LOCAL_DEMO/Stage 5 scope: shallow reorgs orphaning a relayer's own in-flight transaction are rare in the single-worker demo path and this gap does not corrupt funds or double-pay, only stalls a subsequent payment from the SAME signer -- explicitly recorded as a blocker for future work, not swept under a passing gate).

## SPEC-037 fix (B1): signer nonce reconciliation after a reorg orphans a broadcast attempt

**Original discrepancy:** see the entry above -- `signer_state.next_nonce` was never reconciled after `reorgToBlock` orphaned a block containing OUR OWN broadcast transaction, letting every later reservation for that signer allocate a nonce the live chain would never accept next.

**Desired behavior (per B1 prompt item 7):** do NOT blindly lower `next_nonce`, and do NOT assume `max(chainNonce, dbNonce)` repairs anything. Reconcile canonical/pending nonce observations against signed raw transactions, open nonce families, and reserved-but-unsigned journal state. Reuse a known permitted transaction identity where appropriate; block ambiguous allocation rather than issue a second business payment.

**Implementation:**
- `packages/db/src/repositories/txJournal.ts`: `getSendersWithFamiliesClosedInBlocks` (finds senders whose CLOSED nonce family's canonical tx was receipted inside a just-orphaned block); `reconcileSignerNonceAfterReorg` (per-sender, per-gap-nonce reconciliation against a caller-supplied live `eth_getTransactionCount` -- reopens a family ONLY when its payment is not already canonically settled through a different attempt, walking the orphaned attempt SUCCEEDED/REVERTED -> REORGED -> UNKNOWN -> SUBMITTED, every edge already legal in `TRANSACTION_ATTEMPT_STATE_GRAPH`; otherwise records the nonce as `blockedNonces`, reopening nothing); `hasUnresolvedNonceGap` (re-derives, from the same evidence, whether a sender still has an unresolved blocked gap).
- `apps/worker/src/indexer.ts` (`runIndexerTick`'s reorg branch): reads each affected sender's live `eth_getTransactionCount` BEFORE opening the write transaction (CLAUDE.md: never hold a SQL transaction across an RPC call); calls `reconcileSignerNonceAfterReorg` under `lockSigner`'s row lock, in the SAME transaction as `regressAffectedPayments`/`reorgToBlock`, AFTER `reorgToBlock` has flipped canonicality (so the "already settled elsewhere" check reads the POST-reorg canonical view, not stale pre-reorg state); then, OUTSIDE that transaction, immediately rebroadcasts each reopened family's exact persisted raw signed bytes (idempotent, tolerating "already known"/"nonce too low" exactly like `submitPayment.ts`'s own `broadcastAttempt`) -- refilling the gap nonce on-chain right away rather than depending on some other job happening to re-dispatch that specific intent later.
- `apps/worker/src/submitPayment.ts` (`handlePaymentSubmissionJob`): before ANY fresh nonce reservation, reads the live `eth_getTransactionCount` and refuses (`RETRY`, not a silent reservation) while `hasUnresolvedNonceGap` is true for that signer -- the literal "block ambiguous allocation" requirement, for the specific case where the gap nonce's payment already settled elsewhere and cannot be safely refilled.

**Supporting source:** ARCH 3.4 ("Serialize nonce allocation with one signer row/worker"); CLAUDE.md ("Do not pay one invoice through both routes" / never double-pay).

**Affected API/ABI/SQL fields:** none (no schema change; `signer_state`/`nonce_families`/`transaction_attempts` are read/written through existing columns only).

**Migration/regeneration needs:** none.

**Test coverage (`apps/worker/test/indexer.test.ts`, real Anvil + real Postgres, all 4 tests in this file passing):**
1. "a real anvil_reorg ... regresses the payment to UNKNOWN" (pre-existing, unmodified, still passing -- confirms no regression).
2. "SPEC-037: ... a LATER payment from the SAME relayer still actually settles" -- real end-to-end: payment 1 settles, real 3-block `anvil_reorg` orphans it, payment 2 (fresh reservation, same relayer) is driven through the real worker/outbox loop and reaches `SUCCEEDED`; asserts the relayer's live on-chain tx count increased (the gap nonce was genuinely refilled, not skipped). Reproduces the exact failure this session's earlier direct reproduction hit (stuck at `SUBMITTED`) and proves it no longer happens.
3. "SPEC-037: a nonce gap whose payment is ALREADY canonically settled through a DIFFERENT attempt is refused, not silently reopened" -- fabricates a second SUCCEEDED attempt/receipt for the SAME payment (as a legitimate re-versioning would produce) before reorging the first; asserts the original family stays closed (not reopened), proving the "never a second business payment" guard.
4. `apps/worker/test/faultInjection.test.ts` and the rest of `apps/worker/test/` (21/21 total, full suite) rerun clean -- no regression from the new pre-reservation `hasUnresolvedNonceGap` RPC check added to every submission path.

**Known residual scope (honestly documented, not fixed here):** if the gap nonce's payment is genuinely unrecoverable (blocked case), no automatic unstick exists yet -- the signer is refused further fresh reservations until a human/future-stage mechanism resolves it (e.g. a deliberate nonce-filling no-op transaction). This is a deliberate fail-closed choice (per the prompt's own "block ambiguous allocation" instruction), not an oversight; it trades availability for never risking a second real payment. An orphaned-but-reopened attempt's OWN payment record does not automatically return to `SUCCEEDED` even after its rebroadcast re-mines -- it stays at `UNKNOWN`/`ORPHANED_BLOCK` until a real settlement observation (a resubmission via the existing `UNKNOWN -> READY` path, or a future reconciliation enhancement) re-drives it; this is outside SPEC-037's own scope (the nonce gap, not the payment's own status projection) and was not a claim this fix makes.

**Invalidated gates:** none. Stage 1-5 checkpoints unaffected (no code they cover changed shape, only a new-unless-triggered branch added).

**Approval:** implemented and tested this session (B1); self-reviewed per B1's review requirements (nonce/UUID confusion, incorrect nonce rewinds specifically checked -- see `checkpoints/B1.md`).

**Approval:** not applicable -- recorded as a known, deliberately-deferred gap, not a resolved decision.

## SPEC-038 (RESOLVED, B2, found and fixed within the same session): demo-profile discovery had no deployment scoping, a confused-deputy-class gap

**Gap:** Discovered while writing B2's own demo bridge (`apps/api/src/demo/catalog.ts`), not by either a separate review pass or a later fresh-review lens -- self-caught while reasoning through the prompt's explicit "review the bridge as a potential confused-deputy signer" instruction, before any test exercised it. `getDemoProfilesForOwner` (backing `GET /v1/demo/scenarios`) and `getDemoProfileById` (backing `POST /v1/demo/runs`'s profile lookup) both derive a `DemoProfile` from a `policies` row reached through owner-scoped-only lookups (`getVaultsKeysetForOwner`, `getPolicyById`) with no deployment filter, then unconditionally labeled the result's `deploymentId` and evaluated its `available` flag against `context.config.deploymentId`'s route configuration -- the CURRENT API instance's deployment, regardless of which deployment the policy's own vault actually belongs to. An owner who owns vaults across more than one deployment (a realistic case: a stale/decommissioned prior local deployment plus the current live one, both rows persisted in the same Postgres instance since deployments are never deleted) could have a demo profile presented, and its route availability computed, against the WRONG deployment's route list -- either wrongly advertised as available when the current deployment doesn't actually support that route, or vice versa.

**Resolution:** `apps/api/src/demo/catalog.ts`: `getDemoProfilesForOwner` now skips any vault whose `deploymentId` does not equal the current deployment's id before deriving profiles from it; `getDemoProfileById` now fetches the policy's vault via `getVaultById` and returns `null` (treated identically to "unknown profileId", i.e. `RESOURCE_NOT_FOUND`) when `vault.deploymentId !== deployment.id`. Both use the real `deployments`/`vaults` foreign-key relationship already in the schema -- no new column or migration.

**Evidence:** a dedicated test (`apps/api/test/demo.test.ts`, "a profileId belonging to a DIFFERENT deployment's vault is treated as not found, never evaluated against this deployment's config") directly constructs a second `deployments` row + vault + policy inside the same test database, then asserts `POST /v1/demo/runs` with that profileId returns 404 `RESOURCE_NOT_FOUND` and that `GET /v1/demo/scenarios`'s `profiles` list never includes it -- both assertions failed against the pre-fix code path during development (confirmed by writing the fix only after first designing this test against the vulnerable version, per the shared workflow's "reproduce, then fix" discipline) and pass after the fix.

**Impact:** `apps/api/src/demo/catalog.ts` only. No other route's authorization logic shares this code path (every other authenticated route resolves its own vault/deployment scoping independently, e.g. `requireVaultOwner`'s `getVaultWithDeployment` + `assertSessionChainMatches`, none of which had this specific gap).

**Invalidated gates:** none (found and fixed within B2, before the B2 checkpoint was written -- never shipped as a passing gate with this gap present).

**Approval:** implemented and tested this session (B2); directly responsive to the B2 prompt's own "review as a potential confused-deputy signer" instruction -- see `checkpoints/B2.md`'s Review section.

## SPEC-039 (RESOLVED, B3, found and fixed within the same session): `PayGuardV4Adapter` constructor did not enforce its own documented "no-hook, normal-fee" invariant

**Gap:** Found by a fresh-context `agent-skills:security-auditor` dispatched per the B3 prompt's own REVIEW/GATE instruction (not self-caught). `PayGuardV4Adapter.sol`'s header doc comment and every downstream guard (`unlockCallback`'s authentication, the exact-output-delivered check) implicitly assume "fixed pool, no hook, normal fee (3000/60)" as a hard security posture -- a hook executes arbitrary logic inside `poolManager.swap()`, which no other guard in the contract accounts for. The original constructor accepted arbitrary `_hooks`/`_fee`/`_tickSpacing` values with no validation beyond the unrelated `currency0 < currency1` check, so the invariant lived only in a comment and in the deployment SCRIPT's convention (always passing `hooks=address(0)`, `fee=3000`, `tickSpacing=60`), not in the code itself -- a future deployment script (or a copy-paste of this adapter for a different pool) could silently violate it with no revert.

**Resolution:** `contracts/core-v4/src/adapters/PayGuardV4Adapter.sol` constructor now reverts (`HookNotAllowed()`, `FeeNotNormal()`) unless `hooks == address(0)` and `(fee, tickSpacing) == (3000, 60)` (new `NORMAL_FEE`/`NORMAL_TICK_SPACING` constants) -- the invariant is now a code-level, construction-time-enforced guarantee, not a convention.

**Evidence:** all 12 `PayGuardV4AdapterTest` cases (which already construct the adapter with matching values) re-passed after the fix; the full 101-test Foundry suite re-passed with zero regressions. See `docs/implementation/evidence/B3-v4-adapter-evidence.md` for the full review report (also covers two Low-severity test-assertion findings from the same review, fixed alongside this one).

**Impact:** `contracts/core-v4/src/adapters/PayGuardV4Adapter.sol` only. The TS deployment fixture (`packages/test-utils/src/v4VaultFixture.ts`) and `apps/api/scripts/demo-setup.ts` already passed matching values before this fix landed, so neither required a change -- confirmed by rerunning both after the fix (real `demo:setup` provision, and `apps/api/test/v4Route.test.ts`), both still passing.

**Invalidated gates:** none (found and fixed within B3, before the B3 checkpoint was written).

**Approval:** implemented and tested this session (B3); directly responsive to the B3 prompt's own "Have a read-only reviewer challenge ... callback authentication" instruction -- see `checkpoints/B3.md`'s Review section.

## SPEC-040 (RESOLVED, B4, found and fixed within the same session): `check-abi-equivalence.mjs` was not wired into any automated gate, and could not detect enum member reordering

**Gap:** Found by a fresh-context `agent-skills:security-auditor` dispatched per the B4 prompt's own REVIEW/GATE instruction (not self-caught). Two related issues: (1) the ABI-only-shim equivalence script (`contracts/aqua/script/check-abi-equivalence.mjs`) was runnable only by hand -- `forge build`/`forge test` in `contracts/aqua` would succeed even if a future edit to `contracts/core-v4`'s real `IPayGuardVault`/`IPayGuardSettlementAdapter` interfaces silently diverged from the shim, and the shim's own doc comment plus `contracts/aqua/foundry.toml`'s comment both cited a nonexistent `test/ArtifactEquivalence.t.sol` instead of the real script; (2) compiled ABI JSON encodes an enum field only as its underlying `uintN` type -- it never records member names or declaration order -- so the script's structural ABI diff would report `OK` even if `SubsidyMode`'s three members were ever reordered on one side, silently reinterpreting e.g. `REQUIRED(1)` as `BEST_EFFORT(2)` across the pragma boundary.

**Resolution:** (1) `scripts/payguard`'s new `cmd_verify_mvp_B4` runs `node script/check-abi-equivalence.mjs` as one of its `run_step`s -- shim drift now fails the standard gate pipeline, not only a manually-remembered script; both stale `test/ArtifactEquivalence.t.sol` doc-comment references (the shim's own file and `foundry.toml`) corrected to point at the real script. (2) `check-abi-equivalence.mjs` gained `extractEnumMembers`/`assertEnumOrderEqual`, which parse each side's `SubsidyMode` enum declaration directly from SOURCE TEXT (not the compiled artifact, since ABI JSON cannot carry this information) and assert the ordered member-name lists are identical.

**Evidence:** `node script/check-abi-equivalence.mjs` now reports 11/11 checks passing, including `IPayGuardVault.SubsidyMode member order vs shim.SubsidyMode member order (member order: ["NONE","REQUIRED","BEST_EFFORT"])`; `./scripts/payguard verify-mvp B4` runs it as a real pipeline step.

**Impact:** `contracts/aqua/script/check-abi-equivalence.mjs`, `contracts/aqua/foundry.toml`, `contracts/aqua/src/interfaces/IPayGuardSettlementAdapterShim.sol` (doc comment only), `scripts/payguard`. No change to `PayGuardAquaAdapter.sol`'s actual behavior -- both findings were about the STRENGTH of the drift-detection tooling, not a live bug in the shim's current (correct) declarations.

**Invalidated gates:** none (found and fixed within B4, before the B4 checkpoint was written).

**Approval:** implemented and tested this session (B4); directly responsive to the B4 prompt's own "Review compiler boundaries... false SDK assumptions" instruction -- see `checkpoints/B4.md`'s Review section.
