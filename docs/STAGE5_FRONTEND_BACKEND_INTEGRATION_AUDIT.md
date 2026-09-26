# PayGuard Stage 5 Frontend ↔ Backend/Contract Integration Audit

## 0. Executive verdict

- Backend branch: `backend/contract`
- Backend commit: `2021a87d704364d6206b51ebc3835489c93f3b8c`
- Backend implementation state: uncommitted Stage 1–5 work preserved in the working tree
- Frontend comparison branch/ref: freshly fetched `origin/main` (local `main` was nine commits behind and was not used)
- Frontend commit: `d88aaf3fa801f600f92b76b7db008b9fce5e2f01`
- Audit date: 2026-09-14
- Overall compatibility: **MAJOR_MISMATCH**. The visual frontend is a self-contained simulation, not a client of the Stage-5 system.
- Stage 6 recommendation: **READY AFTER P0 FIXES**
- Number of P0/P1/P2/P3 findings: **6 / 5 / 4 / 2**

The Stage-5 backend, database, worker, and `PayGuardVault` form a substantially real and tested system. The `main` frontend does not implement that system's integration boundary: it calls eight unrelated `/api/*` demo endpoints, consumes an in-memory WebSocket state snapshot, performs no wallet or EIP-712 signing, and displays simulated verdicts, events, hashes, balances, and settlement as if they were chain truth. It cannot be connected by changing base URLs or renaming fields.

The existing visual components can be retained, but their data/actions must be replaced by a Stage-5 adapter built on the published `/v1` contract and generated integration package. This can be done without weakening PayGuard's security model. Stage 6 should wait until the signing, deployment/configuration, durable-status, and payment-read boundaries are frozen and the P0 false-authority paths are removed. No frontend requirement found here justifies changing the Stage-6 Solidity security interface.

## 1. What was inspected

### backend/contract

- Contracts: `contracts/core-v4/src/PayGuardVault.sol`, both interface files, generated ABI, deploy fixture, all Foundry suites.
- HTTP/auth: `apps/api/src/app.ts`, `auth.ts`, `authz.ts`, `schemas.ts`, `signatures.ts`, `siwe.ts`, configuration and all route modules.
- Worker: outbox dispatch, relayer, submission, recovery, receipt reconciliation, indexer/reorg handling, heartbeat, and their tests.
- Database: migrations `0001` through `0005`, repositories, transition graphs, migration/concurrency/recovery/indexing tests.
- Shared boundary: `packages/domain`, `packages/chain`, `packages/integration`, generated ABI copies, OpenAPI artifact and drift tests.
- Deployment/test support: `.env.example`, `scripts/payguard`, `packages/test-utils`, Foundry broadcast fixtures.

### main frontend

Inspected from a detached read-only comparison worktree at `origin/main` commit `d88aaf3`:

- `web/src/api.js`, `App.jsx`, `panels.jsx`, `pipeline.jsx`, `main.jsx`, `styles.css`
- `web/vite.config.js`, `web/package.json`
- The companion demo server: `server/src/index.js`, `agent.js`, `ledger.js`
- Main's incompatible prototype contracts: `contracts/src/PayGuardPolicy.sol`, `StockPaySettlement.sol`, deploy script and tests
- Root `README.md` and package manifests

Main has no hidden TypeScript API client, wallet module, generated ABI consumer, query hooks, environment module, or mock-handler directory beyond the explicit Express/in-memory simulator above.

### Tests/checkpoints executed

The audit started `./scripts/payguard verify-stage 05`, which recursively re-executes and then repeats predecessor suites. After the useful suites below had passed, the user confirmed that the full script had already been run previously and did not need another complete repetition. The redundant wrapper was therefore stopped; this audit does **not** claim a fresh top-level `verify-stage 05: PASS`. Its interruption reopened the worker evidence file through `tee`, so the worker suite alone was rerun to completion immediately afterwards to restore that evidence file.

- Reproducible `pnpm install`: passed.
- Strict TypeScript across the seven backend packages: passed.
- Biome: completed with no errors but **127 warnings and one deprecation notice**; this is not accurately described as "lint clean."
- Domain schemas/EIP-712: 24/24 passed.
- Public integration package: 9/9 passed.
- Chain package, including real local Anvil connectivity: 11/11 passed; Foundry warned about stale artifacts under `contracts/core-v4/foundry-pp`.
- API suite against real Postgres/Anvil: 103/103 passed.
- Worker suite against real Postgres/Anvil: 19/19 passed during the wrapper, then 19/19 passed again in the targeted evidence-restoration run.
- Database suite against real PostgreSQL 17: 94/94 passed.
- Foundry full contract suite: 89/89 passed, including the 128,000-call invariant run with zero handler reverts; the predecessor recursion ran this suite twice successfully before the wrapper was stopped.
- Frontend `npm ci`: passed in the disposable `origin/main` worktree; npm reported 4 dependency vulnerabilities (3 moderate, 1 high). No automatic fix was run.
- Frontend `npm run build`: passed; Vite transformed 34 modules and produced the production bundle.
- Static checks: actual OpenAPI route inventory extracted from `docs/implementation/evidence/openapi.json`; exact Solidity structs/type hashes and runtime schemas compared field by field.

### Documents used

- `CLAUDE.md`
- `PAYGUARD_BUILD_PROMPTS.md`
- `PAYGUARD_VERIFIED_REVIEW.md`
- `01_CLAIMS_EXTRACTED.md` (the repository's actual name for `CLAIMS_EXTRACTED.md`)
- `02_VERIFICATION_RESULTS.md` (the repository's actual name for `VERIFICATION_RESULTS.md`)
- `03_REBUILT_ARCHITECTURE.md`
- `API_CONTRACT.md`
- `DATABASE_SCHEMA.sql`
- `reference/CONTRACT_INTERFACE.sol`
- `docs/implementation/{STATE,BUILD_SCOPE,DECISIONS,DEPENDENCIES,SOURCES,SOURCE_MAP,TRACEABILITY}.md`
- `docs/implementation/checkpoints/01.md` through `05.md` and the Stage-5 recovery/evidence files

## 2. Stage 1–5 implementation reality

### Implemented and tested

- `PayGuardVault` is a non-upgradeable per-owner vault with supported-token gating, deposit/withdraw, immutable policy snapshots, terminal agent revocation, execution pause, and approval-nonce cancellation.
- The direct path transfers exact settlement output and measures token deltas. The typed adapter boundary ignores claimed adapter return values and checks actual balances. Reentrancy and adversarial adapter tests exist.
- Invoice identity is `vault + recipient + invoiceId`; agent and approval nonce spaces are additional replay protections. Consumption occurs before external interaction and reverts atomically if settlement fails.
- Output and input budgets remain separate. The exception bypasses only `automaticOutputCap` and remains bound to the exact intent digest.
- EIP-712 domain and all three types are cross-checked between viem, an independent hashing harness, and the actual vault.
- Fastify exposes the complete 26-route API inventory in `API_CONTRACT.md`. Runtime input validation is strict and rejects numeric coercion, leading zeros, excess fields, and width violations.
- SIWE challenge verification persists the original message and challenge session kind. Browser sessions use HttpOnly cookies plus Origin/CSRF; agent sessions use bearer tokens. HTTP identity never replaces merchant, agent, or owner spending signatures.
- Owner transactions are server-prepared, ABI-decoded for review, and never signed by the server. Deposit preparation uses finite approval followed by deposit.
- PostgreSQL stores immutable signed artifacts, one logical payment per invoice, versioned intents, exact approvals, idempotency, operations, leased outbox work, nonce families, raw signed transactions, blocks, receipts, events, cursors, and timeline records.
- Worker tests exercise real Postgres and Anvil for ALLOW, BLOCK, ESCALATE, lost responses, duplicate delivery, replacement, restart, reconciliation mismatch, and reorg regression.
- A full HTTP-to-worker-to-canonical-receipt demonstration exists for direct settlement.

### Implemented but insufficiently tested or incomplete at the public boundary

- Response bodies have no runtime/OpenAPI drift enforcement equivalent to requests.
- `GET /v1/payments/{id}` violates its published non-null shape: `authorized.inputToken` and `routeId` are always `null`; `observedAt.blockNumber` is `null`; settlement can contain `actualInputAtomic:null` despite the declared type.
- `GET /v1/transactions/{hash}` emits `from`, `nonce`, canonical receipt identity, and confidence as `null`, and exposes a replacement row UUID where the contract describes a hash chain.
- Timeline rows return an opaque `body`; tx/block/canonical fields are not guaranteed as top-level response fields.
- Readiness checks database, configured deployment row, chain ID, heartbeat, and relayer balance, but does not prove configured vault runtime code hash, deployed ABI identity, or required route/adapter code.
- Real browser cookie behavior and cross-origin deployment are not end-to-end tested. No CORS plugin is registered.
- True simultaneous races for intent-version and approval creation are not directly tested.

### Specified but not implemented

- A real Stage-5-compatible frontend.
- Stage-6 v4 conversion and merchant subsidy implementation. Stage 1 has a real bare v4 fixture; Stage 2 has only a test adapter boundary.
- Full response-schema validation and the complete transaction/read projections described above.
- Reconciliation of `signer_state.next_nonce` after a reorg orphaning a relayer transaction (`SPEC-037`).
- A complete distributable browser handoff is deferred by the build sequence's Stage 7 `export-integration`, although a usable public package already exists.

### Intentionally deferred

- Aqua/SwapVM is not selected.
- Public testnet deployment, ERC-7715, ENS, World ID, webhooks, KMS, arbitrary targets, mandatory Spend Lockfiles, and UI implementation.
- Stage-6 subsidy behavior. Stage 5 correctly forces `subsidyMode=NONE`.

## 3. Frontend architecture and expectations

- Framework: React 18 + Vite 5, plain JavaScript, no router and no TypeScript.
- API client: eight relative `fetch` calls in `web/src/api.js` to `/api/state`, `/api/scenarios`, `/api/scenario/:id`, `/api/policy`, `/api/preview`, `/api/escalations/:hash/:decision`, `/api/reset`, and `/api/revoke`. It unconditionally calls `response.json()` and never checks HTTP status or a PayGuard envelope.
- Live state: same-origin `/ws` WebSocket delivers an entire mutable in-memory demo state plus transient trace messages. There is no polling of stable resources.
- Auth: none. No SIWE, cookie credentials option, bearer token, CSRF token, Origin-aware mutation wrapper, or login/logout UI.
- Wallet: none. No EIP-1193 provider, wallet library, account/chain subscription, typed-data signing, chain switch, transaction broadcast, or receipt wait.
- State management: local React state and WebSocket snapshots only; no TanStack Query or durable cache identifiers.
- Models: implicit JavaScript shapes from `server/src/ledger.js`, not Stage-5 models. Monetary amounts use `Number`, multiplication/division by `1e6` and `1e18`, and `Math.ceil`/`Math.floor`.
- Mocks: the entire server is a mock. It generates SHA-256-based "keccakish" truncated digests and random fake transaction hashes, mutates policy verdicts and balances in RAM, and presents synthetic blocks/events as on-chain.
- Environment: Vite proxies `/api` and `/ws` to `localhost:8787`. Chain ID `31337`, addresses, merchants, token price, balances, registry, fees, and deployment semantics are hardcoded in the demo ledger.

The frontend currently expects neither Stage-5 HTTP nor Stage-5 cryptography. Its actual expectation is the main-branch Express simulator's shapes and timing.

## 4. API compatibility matrix

`Backend status` refers to the actual Stage-5 implementation. `Frontend usage` refers only to `origin/main`.

| Endpoint | Backend status | Frontend usage | Request match | Response match | Auth match | Severity | Required action |
|---|---|---|---|---|---|---|---|
| `GET /v1/config` | Implemented | None; hardcoded demo config | N/A | None | Public compatible | P0 | Bootstrap frontend exclusively from config plus vault discovery. |
| `POST /v1/auth/challenges` | Implemented/tested | None | None | None | None | P0 | Add SIWE challenge flow. |
| `POST /v1/auth/verify` | Implemented/tested | None | None | None | None | P0 | Verify wallet signature; store CSRF only in memory. |
| `POST /v1/auth/logout` | Implemented/tested | None | None | None | None | P1 | Add session logout; do not label it agent revocation. |
| `GET /v1/operations/{id}` | Implemented | None | None | None | None | P0 | Poll durable operation identity after commands/reload. |
| `GET /v1/vaults` | Implemented | None | None | None | None | P0 | Replace in-memory vault seed with owner query. |
| `GET /v1/vaults/{id}` | Implemented/tested | None | None | None | None | P0 | Render balances/policies from observed view. |
| `POST /v1/vaults/{id}/transactions` | Implemented/tested | None | None | None | None | P0 | Prepare, review, wallet-send each ordered transaction. |
| `POST /v1/policy-drafts` | Implemented/tested | `/api/policy` mutates RAM immediately | Major | Major | None | P0 | Use owner draft resource and decimal strings. |
| `PUT /v1/policy-drafts/{id}` | Implemented/tested | None | None | None | None | P1 | Use optimistic draft version. |
| `POST /v1/policy-drafts/{id}/transaction` | Implemented/tested | UI says on-chain but does not transact | None | None | None | P0 | Sign/broadcast prepared `createPolicy` call. |
| `POST /v1/chain-observations` | Implemented/queued | None | None | None | None | P0 | Submit owner tx hash as a hint and poll operation. |
| `GET /v1/policies/{id}` | Implemented | Reads RAM state | Major | Major | None | P0 | Render observed policy/counters and observation. |
| `POST /v1/policies/{id}/revocation-transaction` | Implemented | `/api/revoke` flips RAM boolean | Major | Major | None | P0 | Prepare and wallet-broadcast revocation. |
| `POST /v1/invoices` | Implemented/tested | Scenario fabricates unsigned invoice | Major | Major | None | P0 | Submit exact merchant-signed Invoice. |
| `POST /v1/payment-intents` | Implemented/tested | Server fabricates unsigned incompatible intent | Major | Major | None | P0 | Agent signs exact stored invoice/policy-bound intent. |
| `POST /v1/payment-intents/{id}/simulate` | Implemented/tested | `/api/preview` runs JS policy engine | Major | Major | None | P0 | Use server/on-chain evaluation and exact simulation. |
| `GET /v1/payment-intents/{id}/approval-typed-data` | Implemented/tested | None | None | None | None | P0 | Fetch exact intent-bound owner payload. |
| `POST /v1/payment-intents/{id}/approvals` | Implemented/tested | Plain approve/reject REST action | Major | Major | None | P0 | Owner signs typed data and uploads signature. |
| `POST /v1/payment-intents/{id}/submit` | Implemented/worker-backed | Scenario endpoint starts fake settlement | Major | Major | None | P0 | Submit stored identity only with idempotency key. |
| `GET /v1/payments` | Implemented | Fake RAM log/settlements | None | None | None | P0 | Use durable list and status-specific refetch. |
| `GET /v1/payments/{id}` | Implemented but response gaps | None | None | None | None | P1 | Fix backend projection, then make it payment truth. |
| `GET /v1/payments/{id}/timeline` | Implemented but loosely projected | Fake RAM log | None | None | None | P1 | Normalize durable timeline contract and render it. |
| `GET /v1/transactions/{hash}` | Implemented but incomplete | Random hash is treated as settled | None | None | None | P1 | Complete projection and use it for observation only. |
| `GET /health/live` | Implemented/tested | None | None | None | Public compatible | P2 | Use for process health only. |
| `GET /health/ready` | Implemented but deployment checks incomplete | None | None | None | Public compatible | P0 | Add code/ABI/route readiness and gate preparation. |

Every required endpoint is therefore `FRONTEND_NOT_USING`; the closest demo endpoints are `FRONTEND_MOCKED`, not minor route aliases.

## 5. Shared data-model compatibility

### PolicyConfig

| Field | Solidity | Backend/API | Frontend | Match? | Required correction |
|---|---|---|---|---|---|
| agent/inputToken/settlementToken/adapter/routeId | address/address/address/address/bytes32 | exact strings | only implicit session agent; no tokens/adapter/route | No | Source selection from config/vault, never form-defined addresses. |
| totalOutputBudget/epochOutputBudget | uint256 | decimal strings | `totalBudget`/`dailyCap` Numbers | No | Use atomic decimal strings; label epoch from policy semantics. |
| automaticOutputCap/escalationOutputCap | uint256 | decimal strings | `perTxCap`/`escalationCeiling` Numbers | Semantic only | Map presentation to exact atomic fields. |
| totalInputBudget/maxInputPerPayment | uint256 | decimal strings | absent | No | Add input-asset limits to review. |
| validAfter/validUntil | uint48 | decimal strings | JS millisecond `expiresAt` | No | Convert explicitly; never sign milliseconds. |
| allowedCategoryBitmap | uint256 | decimal string | string array | No | Map categories through canonical IDs/bitmap. |
| subsidyMode | uint8 enum | wire string | implicit always merchant-paid/fallback | No | Stage 5 must use `NONE`; only advertise Stage-6-enabled modes. |

### MerchantPermission

| Field | Solidity | Backend/API | Frontend | Match? | Required correction |
|---|---|---|---|---|---|
| merchantId | bytes32 | Hash32 | absent | No | Use configured/policy snapshot ID. |
| recipient | address | Address | demo merchant address | Shape only | Do not trust hardcoded registry. |
| invoiceSigner | address | Address | absent | No | Display signer and require signature. |
| category | uint32 | decimal string restricted to 0–255 | free-form string | No | Map through canonical category value. |

### Invoice

| Field | Solidity | Backend/API | Frontend | Match? | Required correction |
|---|---|---|---|---|---|
| invoiceId/merchantId | bytes32/bytes32 | Hash32 | absent | No | Preserve merchant-issued identities. |
| recipient/settlementToken | address/address | Address | merchant object/no token address | No | Use exact signed addresses. |
| outputAmount | uint256 | decimal string | Number `amount` | No | Atomic decimal string. |
| category/validUntil | uint32/uint48 | decimal strings | category string/JS number expiry | No | Canonical conversion before signing. |

### PaymentIntent

All eight Solidity fields (`policyId`, `invoiceHash`, `routeId`, `maxInputAmount`, `nonce`, `validUntil`, `subsidyMode`, `maxSubsidyAmount`) are present exactly in the backend. The frontend's five-field `{merchant,amount,category,expiry,nonce}` is a different message and is not EIP-712 signed. **No fields match as a signed structure.** It must use the shared integration types rather than adapt the prototype contract.

### ExceptionApproval

Backend/Solidity: `{intentHash:bytes32, nonce:uint256, validUntil:uint48}`. Frontend: no structure or signature; an unauthenticated REST button changes server RAM. Correction: fetch typed data, independently review exact recipient/output/input/route, sign through the owner wallet, and POST the exact signature. Do not add a reject signature unless product requirements explicitly need one; not approving is sufficient for on-chain authority.

### PaymentView

Backend has all four state axes and most invoice/settlement fields, but currently returns null for several declared non-null fields. Frontend has a monolithic `run.outcome`, a fake transaction, and mutable state/log objects. Replace rather than map `settled` directly: only `executionStatus=SUCCEEDED`, canonical evidence, and `reconciliation=MATCHED` may drive settled UI.

### Operation

Backend `{operationId,resourceType,resourceId,status}` with durable result/hash. Frontend has no operation type; POST success begins an in-memory sequence. Add stable operation polling and reload recovery.

### Observation

Backend `{blockNumber,blockHash,canonical,observedAt}`; frontend uses incremented numeric fake block/time. Use backend observation only. Fix the backend's null `blockNumber` before freeze.

### UnsignedTransaction

Backend exactly returns decimal-string chain/value, from/to/data/calldataHash and ABI version. Frontend has none. Translate the wire representation to wallet-library types, validate account/chain/to/calldata, and invalidate it on provider changes.

## 6. Cryptographic compatibility

### EIP-712 domain

**Backend/contract: PASS. Frontend: FAIL.** Domain is `name=PayGuard`, `version=1`, live `chainId`, `verifyingContract=actual vault`. The frontend has no typed-data domain and its simulator's digest is truncated SHA-256 text.

### Invoice signing

**Backend/contract: PASS. Frontend: FAIL.** Exact type:

```text
Invoice(bytes32 invoiceId,bytes32 merchantId,address recipient,address settlementToken,uint256 outputAmount,uint32 category,uint48 validUntil)
```

Merchant invoice signer is policy-pinned. Main fabricates unsigned invoices.

### PaymentIntent signing

**Backend/contract: PASS. Frontend: FAIL.** Exact type:

```text
PaymentIntent(bytes32 policyId,bytes32 invoiceHash,bytes32 routeId,uint256 maxInputAmount,uint256 nonce,uint48 validUntil,uint8 subsidyMode,uint256 maxSubsidyAmount)
```

Main's prototype Intent is structurally unrelated.

### ExceptionApproval signing

**Backend/contract: PASS. Frontend: FAIL.** Exact type:

```text
ExceptionApproval(bytes32 intentHash,uint256 nonce,uint48 validUntil)
```

The API deterministically chooses `nonce=uint256(intentHash)` and binds expiry to the intent. The vault rechecks owner/ERC-1271 validity and consumes the nonce atomically. This binds approval to the exact route, recipient, output and input ceiling transitively through `intentHash` and `invoiceHash`.

### Golden vectors

**Backend/shared/Solidity: PASS. Frontend participation: FAIL.** Fresh domain tests passed. Existing vector suites compare viem, an independent Solidity harness, and the actual vault, including mutated fields and wrong domain. No frontend code imports or verifies those vectors.

### Signature ownership

| Artifact | Required signer | Current frontend behavior | Verdict |
|---|---|---|---|
| Invoice | policy-pinned merchant invoice signer | fabricated by scenario server | FAIL |
| PaymentIntent | policy agent | claims signing in trace text only | FAIL |
| ExceptionApproval | vault owner | unauthenticated REST decision | FAIL |
| Outer execution tx | relayer only | no real tx | FAIL |

API login is correctly separate in Stage 5. Main has no login and no spending signatures.

### Replay identities

**Backend/contract: PASS with known worker reorg caveat. Frontend: FAIL.** Backend has invoice identity, agent nonce, approval nonce, HTTP idempotency and relayer nonce family. Main has random four-byte nonces and RAM-only consumption, all lost on restart.

## 7. End-to-end flow analysis

### A. Login

```text
Current: page loads -> unauthenticated /api/state + /ws
Expected: wallet -> challenge -> sign exact SIWE message -> verify -> cookie + CSRF -> authenticated reads
```

Mismatch: the entire flow is absent. Required correction: implement Stage-5 SIWE; include credentials for cookie requests and Origin/X-CSRF-Token on mutations. A chain/account change requires a new scoped login.

### B. Vault funding

```text
Current: hardcoded RAM balance already funded
Expected: config -> vault GET -> allowance/balance -> prepared finite approve -> receipt -> prepare/recheck -> deposit -> observation -> operation/vault polling
```

Mismatch: no wallet or transactions; fake `1.25e18` uses unsafe Number. Required correction: ordered wallet steps with receipt checks and re-preparation after any state/account/network change.

### C. Policy creation

```text
Current: form -> POST /api/policy -> mutate RAM -> fabricate PolicyCreated log
Expected: draft -> versioned edit -> prepare createPolicy -> owner review/sign/broadcast -> observation -> active policy GET
```

Mismatch: UI label "Update policy on-chain" is false. Required correction: connect all four resource phases; never treat draft save as authority.

### D. ALLOW

```text
Current: scenario fabricates invoice/intent -> JS preview/evaluate -> delay -> JS settle -> random tx hash
Expected: signed invoice -> signed intent -> API/vault evaluation -> simulation -> submit -> durable worker -> executePayment -> canonical receipt/event -> MATCHED PaymentView
```

Mismatch: every authority and evidence boundary is bypassed. Required correction: Stage-5 flow end to end; `202`, tx hash, `SUBMITTED`, and `INCLUDED` remain pending.

### E. ESCALATE

```text
Current: RAM escalation -> click Approve -> RAM flag -> retry
Expected: ESCALATE payment -> owner fetches exact typed data -> signs ExceptionApproval -> API stores it -> submit -> vault rechecks/consumes it
```

Mismatch: no signature, expiry, nonce, exact-intent review, or owner auth. Required correction: exact Stage-5 flow. The submit endpoint accepts no changed route/recipient/amount, so once this flow is used the frontend cannot mutate approved fields.

### F. BLOCK

Current JS creates a fake `PaymentBlocked` log and explicitly claims "emitted · tx reverted." That is impossible for a reverted EVM call: the event is reverted too. Expected behavior is the durable signed attempt plus deterministic backend/vault evaluation and reason, with no claim of a persisted denial event. Required correction: render the off-chain payment record/evaluation.

### G. UNKNOWN/recovery

Main has no UNKNOWN state. Any WebSocket loss or server restart loses the run. Expected behavior is to preserve payment/operation/transaction identities; `UNKNOWN` is pending uncertainty, not FAILED, BLOCKED, or settled. Poll operation/payment/transaction until canonical resolution.

### H. Restart recovery

Main depends on process RAM and transient WebSocket messages. Stage 5 persists the necessary identities, raw relayer transaction, observations, and timeline. Required correction: rebuild every screen from `/v1/config`, vault/policy/payment GETs, and stable IDs after reload. WebSocket may later be an optimization, never the authority.

## 8. Contract/deployment integration

- Canonical ABI source: actual Foundry build of `contracts/core-v4/src/PayGuardVault.sol`.
- Generated copies: `packages/chain/src/generated/abi.ts`, `packages/integration/src/generated/abi.ts`, and evidence ABI. Drift tests prove current equality.
- Canonical frontend package: `@payguard/integration`, extended/packaged by Stage 7 export. Frontend must not use main's `PayGuardPolicy`/`StockPaySettlement` ABI.
- Chain/deployment/tokens/decimals/routes/environment: use `GET /v1/config`; discover the owner vault with `GET /v1/vaults`.
- Main duplicates chain ID, token symbols/decimals, merchants, prices, balances, and addresses manually.
- `GET /v1/config` is sufficient to eliminate duplicated chain, token, route, adapter and environment configuration, but not by itself the selected vault address or wallet-provider project configuration. Vault address comes from authenticated vault discovery; WalletConnect project ID, if a library requiring it is chosen, remains frontend deployment configuration.
- Readiness must additionally verify vault runtime code hash, ABI schema/runtime compatibility, and enabled adapter/route code before this boundary is frozen. Merely finding the deployment row and matching chain ID is insufficient.
- Mock tokens must remain explicitly labeled by `isMock`; the UI must not market them as live assets.

## 9. Database/read-model readiness

| Frontend-visible field | Actual source | Ready? |
|---|---|---|
| paymentId, deploymentId, chainId | payments -> vaults -> deployments | Yes |
| intentId | active payment_intents row | Yes, nullable before intent |
| invoice fields | invoices | Yes |
| authorized.maxInputAtomic | payment_intents | Yes |
| authorized.inputToken | policies.input_token/config projection | **No: response hardcodes null** |
| authorized.routeId | payment_intents typed artifact or policies.route_id | **No: response hardcodes null** |
| policyDecision/executionStatus/confidence/reconciliation/reasonCode | payments | Yes |
| settlement amounts | canonical decoded `PaymentExecuted` | Mostly; actual input can still become null in a declared non-null object |
| transaction.hash | transaction_attempts | Yes |
| transaction.replacementOf | replacement relationship | **Incorrect projection: uses canonical family hash/row identity inconsistently** |
| observedAt.blockHash/time | payment row | Partial |
| observedAt.blockNumber | chain_blocks join | **No: hardcoded null** |
| timeline | payment_timeline | Durable but opaque; required tx/block/canonical shape not guaranteed |
| operation | operations + result JSON | Durable; multi-step owner actions are encoded in result |
| vault balances | live contract/token reads | Yes when RPC works |
| policy counters | contract policy state | Yes |
| transaction sender/nonce/receipt/confidence | tx journal + receipts/blocks | Stored, **not projected** |

There is no correctness-critical N+1 blocker in payment detail, but vault list performs one deployment lookup per vault. That is not worth changing for speculative scale. The correctness work is projection completeness and response validation.

All existing main payment history is RAM-only and not reconstructable after restart. All Stage-5 payment history is reconstructable from durable state, subject to completing the public projections above and the known relayer nonce/reorg gap.

## 10. Frontend mocks and placeholders

| Location | Current behavior | Safe for demo? | Backend replacement |
|---|---|---|---|
| `server/src/ledger.js` | Entire payment ledger/policy engine in memory | Only if visibly labeled simulation | Remove as authority; use `/v1` resources. |
| `ledger.js:5-6,46,128-143` | Number arithmetic across 6/18 decimals | No for integration | Decimal strings + BigInt/formatting library. |
| `ledger.js:9,61-62` | SHA-256 text digest truncated with ellipsis | No | Shared EIP-712 helpers. |
| `ledger.js:14-25,30-48` | Hardcoded merchants, chain, addresses, price, balances | Presentation fixture only | config + vault/policy resources. |
| `ledger.js:151-158` | Random fake tx hash and immediate settlement mutation | No | worker/payment/transaction polling. |
| `agent.js:6,48-120` | Timed theatrical pipeline and client-owned verdict path | Animation only | drive animation from backend state. |
| `agent.js:87-90` | Claims a reverted tx emitted PaymentBlocked | No | stored signed attempt/evaluation. |
| `server/src/index.js:30-44` | Policy write fabricates PolicyCreated | No | draft + owner tx + observation. |
| `index.js:68-79` | Approval is a plain REST boolean | No | intent-bound owner signature. |
| `web/src/panels.jsx:47` | "Update policy on-chain" for RAM mutation | No | only show after observed policy event. |
| `panels.jsx:99-101` | "Approve and settle" and "World ID verified" without proof | No | sign approval; separately submit/poll; remove World claim. |
| `panels.jsx:116` | "every attempt, on-chain" for fake log | No | durable payment timeline with evidence labels. |
| `pipeline.jsx` | Shows simulated route/fee/receipt as chain fact | No | config route plus canonical settlement fields. |

## 11. Error and status compatibility

- HTTP errors: main ignores `response.ok` and assumes JSON. It cannot distinguish PayGuard `Failure`, retryability, 401 reauth, 403, 409 idempotency/version conflicts, 422 evaluation errors, or 503 chain/deployment unknown.
- Domain errors: main uses prose strings and prototype contract errors, not generated Stage-5 errors/reason enum.
- Decisions: main knows ALLOW/ESCALATE/BLOCK but not backend `UNKNOWN`; its semantic rules also differ.
- Execution: main has `run.outcome` values such as `settled`, `blocked`, `escalated`, and `reverted`; it lacks all 12 execution states.
- Confidence/reconciliation: entirely absent.
- Replacement/reorg: entirely absent.
- False settlement: main treats the simulator's generated `tx` object as settled. It does not currently conflate real API 2xx, tx hash, SUBMITTED, or INCLUDED with SUCCEEDED because it never receives those real states; however, its current mental model is immediate hash-plus-success and would do so if naively wired.
- Canonical UI rule: settled only when `executionStatus=SUCCEEDED`, `reconciliation=MATCHED`, settlement is non-null, and the observation is canonical at the configured confidence policy. `INCLUDED` is not `SUCCEEDED`; `UNKNOWN` is not `FAILED`; `BLOCK` is policy outcome, not transaction state.

## 12. Integration findings

### P0 blockers

#### INT-001: Main implements no Stage-5 API protocol

**Evidence**

- backend: OpenAPI contains all 26 required routes; route modules implement them.
- frontend: `web/src/api.js` calls only eight `/api/*` simulator paths.
- specification: `API_CONTRACT.md` lines 64–225.

**Problem**: no frontend action or read reaches Stage 5. **Why it matters**: the protocol is unusable. **Canonical fix**: replace the data/action adapter using `@payguard/integration`; preserve visual components if desired. **Owner**: frontend/shared. **Must be fixed before**: Stage 6 interface freeze, frontend merge, real demo.

#### INT-002: No wallet, SIWE, cookie/CSRF, or chain-scoped session

**Evidence**: Stage 5 implements these in auth routes/guards; main has only React/ReactDOM dependencies and anonymous fetch. **Problem**: owner and agent actions cannot be authenticated. **Why it matters**: broken login and authority confusion. **Canonical fix**: EIP-1193 wallet integration and exact SIWE flow; use credentials and CSRF/Origin correctly. **Owner**: frontend with deployment config. **Must be fixed before**: frontend merge and demo.

#### INT-003: Frontend does not create any required cryptographic artifact

**Evidence**: backend exact EIP-712 types in `packages/domain/src/eip712.ts` and Solidity type hashes; main creates unsigned incompatible objects and boolean approvals. **Problem**: merchant, agent and owner authority are absent. **Why it matters**: naive accommodation would destroy the security model or sign wrong data. **Canonical fix**: consume shared types/vectors; never alter contract types to fit main's prototype. **Owner**: frontend/shared. **Must be fixed before**: Stage 6 and frontend merge.

#### INT-004: Unsafe monetary arithmetic and non-digests are treated as identities

**Evidence**: `USDC(Number)`, `1.25e18`, multiply/divide by `1e18`, `Math.ceil`, and truncated SHA-256 in `ledger.js`. **Problem**: atomic values and hashes cannot round-trip. **Why it matters**: wrong amount, replay identity, or approval review. **Canonical fix**: decimal-string wire values, BigInt internally, typed formatting at the edge, full Hash32 only. **Owner**: frontend. **Must be fixed before**: any signed or funded integration.

#### INT-005: Simulated client/server state is falsely presented as chain payment truth

**Evidence**: JS computes verdicts/settlement, random hashes, fake block/event logs, and UI claims "on-chain." **Problem**: frontend owns policy decisions and settlement truth. **Why it matters**: it can falsely report settlement and invent impossible BLOCK events. **Canonical fix**: remove simulator authority; animations consume durable backend states and canonical evidence. **Owner**: frontend. **Must be fixed before**: demo and frontend merge.

#### INT-006: Deployment compatibility is not end-to-end locked

**Evidence**: frontend hardcodes chain/assets; `/health/ready` does not verify vault runtime code/ABI or enabled adapter code; frontend has no config bootstrap. **Problem**: correct chain ID alone can still point at wrong code/address/schema. **Why it matters**: wrong contract/network is a P0 outcome and Stage 6 changes route capability. **Canonical fix**: extend readiness to runtime/ABI/route identity, bootstrap frontend from config, fail closed on mismatch. **Owner**: backend/shared/frontend. **Must be fixed before**: Stage 6 and demo.

### P1

#### INT-007: PaymentView violates its published wire type

Hardcoded null `authorized.inputToken`, `authorized.routeId`, and `observedAt.blockNumber`, plus a nullable actual input inside non-null settlement. Populate from existing joins and add response-schema contract tests. Owner: backend/shared. Before frontend merge.

#### INT-008: Transaction and timeline projections are incomplete

Sender, nonce, canonical receipt, confidence, hash-based replacement chain, and normalized timeline evidence are missing or opaque despite durable storage. Complete the narrow read projections. Owner: backend/shared. Before frontend merge.

#### INT-009: Browser deployment model is unresolved

Current main assumes same-origin Vite proxy to port 8787. Stage 5 defaults API/SIWE to port 3000, requires explicit allowed Origin, has Secure/SameSite=Strict cookies, and registers no CORS. Choose a same-origin reverse proxy (recommended) or intentionally configure/test credentialed CORS and cookie attributes. Owner: deployment/frontend/backend. Before frontend merge.

#### INT-010: Prepared actions have no stale-account/network defense in the UI

Main has no provider events. Add account/chain subscriptions, clear session/prepared transactions/signing requests on change, and re-read config/resources. Owner: frontend. Before funded demo.

#### INT-011: Stable browser artifact consumption is not yet demonstrated

Generated ABI/integration package exists and passes external CLI tests, but main neither consumes it nor proves browser bundling. Define a versioned package/export and build a browser contract test before freeze. Owner: shared/frontend. Before frontend merge.

### P2

#### INT-012: Fetch/error behavior discards HTTP semantics

Introduce a typed client that validates envelopes, checks status, handles retryable errors, and preserves request IDs. Owner: frontend.

#### INT-013: Prototype policy concepts require explicit presentation mapping

`dailyCap`, category strings, session key, per-tx cap, and merchant registry do not map one-to-one to epoch budget, bitmap/category, policy agent, automatic cap, and policy merchant snapshots. Keep friendly labels but review canonical fields. Owner: frontend/shared.

#### INT-014: Funding and policy workflows need multi-step UX

The UI currently assumes one click equals completion. Model prepare/review/wallet/receipt/observation separately, including two-step finite approval/deposit. Owner: frontend.

#### INT-015: Known relayer nonce state can stall after a reorg

`SPEC-037` does not double-pay but can prevent later payments from progressing. Fix before adding Stage-6 relayer traffic or claiming robust recovery. Owner: worker/database.

### P3

#### INT-016: Query/cache tooling is optional but would simplify recovery

TanStack Query or an equivalent is not required, but stable keyed polling and invalidation should replace bespoke transient state. Owner: frontend.

#### INT-017: Vault-list deployment lookup is N+1

One deployment lookup per vault is harmless at demo scale. Join only if measured or convenient during the narrow read-model correction. Owner: backend.

## 13. Contract/API freeze proposal

Freeze after INT-003, INT-006, INT-007, INT-008 and the corresponding tests pass:

- EIP-712 domain and exact Invoice, PaymentIntent, ExceptionApproval types, field order and widths.
- `PayGuardVault` owner/funding/policy/evaluate/execute/view ABI, event/error identities, invoice identity and nonce semantics.
- Exception scope: automatic-cap-only, exact-intent binding.
- HTTP signed object shapes, decimal-string numeric rule, envelopes, auth/session split, idempotency semantics.
- Route IDs and `(adapter,inputToken,outputToken,subsidy modes)` meaning.
- All four status axes and error codes.
- Deployment/config schema and readiness identity rules.

Explicitly remain flexible:

- React component layout, copy, animation, query library and local display units.
- Pagination sizes/poll intervals within server limits.
- Additional non-authoritative display metadata.
- Optional future push transport; GET resources remain canonical.
- Stage-6 internal adapter implementation and gas strategy, provided the frozen adapter/ABI/security postconditions remain intact.
- Optional Aqua, public testnet, ENS/World/ERC-7715 until separately selected and verified.

## 14. Integration test plan

### Shared-schema tests

1. Import every request/response type from the shipped browser package and validate examples against OpenAPI/runtime schemas.
2. Round-trip `0`, `2^53`, `2^53+1`, and `2^256-1` decimal strings without Number conversion; reject exponent, sign and leading zero.
3. Assert generated ABI/errors/events byte equality with Foundry artifact and configured ABI version.
4. Fail readiness/client bootstrap for wrong deployment, chain, runtime code hash, ABI and route adapter.

### API integration

5. SIWE browser flow in a real browser: cookie set/sent, allowed Origin accepted, missing/wrong CSRF rejected, logout invalidates session.
6. Every frontend request fixture validated by the actual Fastify route; every response validated by the shared response schema.
7. Same Idempotency-Key/body returns original resource/operation; changed body yields 409.
8. Duplicate invoice identity with changed bytes yields `INVOICE_ID_REUSED`; simultaneous identical creation cannot produce two payments.
9. Payment detail, timeline, transaction and operation survive process/page restart with all declared fields populated.

### Wallet/signature

10. Browser/viem/Solidity golden equality for all three types plus one mutation per protected field and wrong chain/vault.
11. Owner-prepared approve/deposit/createPolicy/revoke calls decode exactly to their review and execute against Anvil.
12. Account or chain switch clears SIWE session context, prepared txs, typed data and pending submit controls.
13. Mutating recipient/output/route/max input after approval changes digest and fails; exact approved intent succeeds.
14. EOA and ERC-1271 owner approval paths; wrong signer, nonce, expiry, and cancellation fail.

### Backend/contract

15. ALLOW direct payment through HTTP -> worker -> canonical receipt-backed `SUCCEEDED/MATCHED`.
16. BLOCK persists signed attempt/reason with no claimed on-chain denial event and no fund movement.
17. ESCALATE -> exact owner signature -> submit -> receipt-backed success.
18. Receipt with wrong emitter, policy, intent, recipient, token, output or route never produces success.
19. Submission 202, transaction hash, SUBMITTED and INCLUDED each remain visually pending; only canonical verified success settles.

### Recovery

20. RPC accepted tx then timed out -> UNKNOWN -> restart -> same raw tx identity -> receipt/revert.
21. Worker restart at nonce-reserved, signed, submitted and included windows.
22. Fee replacement retains nonce/to/value/calldata and UI follows hash chain.
23. Reorg clears settlement, changes confidence/reconciliation, and recovers or explains terminal state.
24. Fix/test `signer_state` rewind/reconciliation after orphaning before Stage-6 traffic.

### Frontend contract tests

25. Mock server generated from Stage-5 schemas, not hand-authored happy paths.
26. All 26 endpoints classified as used or intentionally unused; no `/api/*` simulator calls in production build.
27. Reload during every execution state reconstructs the same screen from GET resources.
28. No rendered value labeled on-chain/settled/verified can be sourced solely from fixture, WebSocket trace, tx submission, or local calculation.

## 15. Proposed integration sequence

1. Resolve P0 deployment/readiness and signing-boundary issues; do not change invariants.
2. Correct PaymentView/transaction/timeline projections and add response schemas.
3. Freeze ABI, EIP-712, HTTP models, enums, errors, route/config schema.
4. Produce and browser-test the generated `@payguard/integration` artifact.
5. Replace main's API/WS simulator adapter with config bootstrap, SIWE and authenticated query client.
6. Connect vault discovery and ordered funding actions.
7. Connect draft/create/revoke owner flows.
8. Connect merchant invoice and agent intent flows.
9. Connect exact escalation typed-data approval.
10. Connect operation/payment/transaction polling, UNKNOWN/restart/reorg recovery.
11. Remove or unmistakably isolate unsafe simulation fixtures and false chain labels.
12. Run the complete acceptance plan on one reproducible local deployment.
13. Fix `SPEC-037`; re-run recovery gates.
14. Only then begin Stage 6 against the frozen boundary.

## 16. Stage 6 readiness decision

### READY AFTER P0 FIXES

The Stage-5 security kernel is a sound base, and no frontend need requires a Solidity invariant change. Stage 6 should nevertheless wait because the current frontend has no valid signing/protocol/deployment boundary, while backend readiness does not yet prove runtime ABI/route identity. Beginning conversion/subsidy now would make it harder to distinguish frontend incompatibility from a new route's behavior and would freeze an incomplete public read contract.

This is not a request to make the entire frontend production-complete first. The minimum gate is: exact shared signing works from a browser; configuration/readiness fails closed; durable status is rendered correctly; PaymentView/transaction evidence satisfies its schema; and simulator authority cannot masquerade as Stage-5 truth.

## 17. Questions requiring human decision

1. Will the browser and API be deployed behind one origin (recommended), or on separate origins requiring credentialed CORS and a deliberate SameSite cookie policy?
2. Which actor/system supplies real merchant-signed invoices to the demo? The frontend must not fabricate the merchant signature, but the product entry point (merchant page, fixture signer service, or pre-seeded signed examples) is not specified.
3. Should the theatrical scenario runner remain as an explicitly labeled demo mode backed by real Stage-5 resources, or should the integration expose only normal product workflows?

No human decision is needed about weakening signatures, adding Spend Lockfiles, or changing the Stage-6 vault interface; the answer is no.

## 18. Recommended next prompt

Implement only the P0/P1 integration-boundary fixes: complete and runtime-validate public read/config/readiness schemas; export a browser-consumable generated integration package; replace main's simulator API with SIWE, wallet signing, prepared owner actions and durable payment polling; preserve the existing visual design; isolate all demo fixtures; add the concrete browser/API/EIP-712/recovery contract tests from this audit; do not begin Stage 6 or change PayGuard security invariants.

## Explicit answers to the 15 review questions

1. **Can main integrate without changing the security model?** Yes, by replacing its integration/data layer and retaining presentation components. No backend security relaxation is needed.
2. **Does frontend calculate policy verdicts?** Yes. `server/src/ledger.js::preview/evaluate` is an authoritative JS policy engine today. It must become presentation-only or be removed.
3. **Does frontend treat API success/hash/SUBMITTED/INCLUDED as SUCCEEDED?** It has none of the real states; it treats creation of a fake transaction object/random hash as settled. A real adapter must explicitly avoid all four equivalences.
4. **Are monetary values safe?** No. Main uses JavaScript Number across atomic 6/18-decimal values.
5. **Exact EIP-712 types?** No typed-data signing exists; the prototype intent is incompatible.
6. **Approval bound to exact intent?** Backend/contract yes; frontend no approval signature exists.
7. **Can changed route/recipient/amount be submitted after approval?** Main can mutate arbitrary RAM objects. Stage-5 submit cannot, because it accepts `{}` and uses the stored signed intent; the integrated frontend must use that path.
8. **Is config sufficient?** For chain/deployment/tokens/routes/environment yes; vault address comes from vault discovery and wallet-provider project settings remain frontend config.
9. **CORS/cookie/CSRF compatible?** Not yet established. Main's same-origin Vite proxy targets another server; choose/test the final deployment model.
10. **Can switching create stale actions?** Yes in any naive integration; main has no wallet listeners. Stage-5 API states the invariant but cannot clear browser state itself.
11. **Are mocks distinguishable?** No. UI copy repeatedly calls simulated data on-chain/verified/settled.
12. **Enough backend data for every screen?** Durable sources mostly exist, but public PaymentView/transaction/timeline projections are incomplete.
13. **Recover after reload while UNKNOWN?** Stage-5 resources can; current main cannot. The new client must retain stable IDs/poll GETs.
14. **Are histories reconstructable?** Stage-5 histories yes from durable state, subject to projection fixes; main histories no, because they live in RAM.
15. **Reason to alter Stage-6 contract interface?** **No.** The frontend needs an adapter and correct types, not weaker or different on-chain authority.
