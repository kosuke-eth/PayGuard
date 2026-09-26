# PayGuard integration boundary: continuation decisions

Version 2.0. This is a focused companion to the EXISTING `API_CONTRACT.md`, actual Solidity interfaces, and `packages/integration`. It is not a replacement API/ABI. New bridge items below are proposals to implement and verify in B2, not endpoints claimed to exist today.

## 1. Preserve the implemented authority surface

The source tree locates signing descriptors in `packages/domain/src/eip712.ts`, input schemas in `packages/domain/src/schemas.ts` and `apps/api/src/schemas.ts`, public models/client in `packages/integration/src/`, and Solidity interfaces in `contracts/core-v4/src/interfaces/`. Inspect those actual files before changing anything.

Keep owner configuration as prepared wallet transactions; merchant invoices as merchant-signed data; PaymentIntent as agent-signed data; ExceptionApproval as owner-signed data; and outer transaction submission as worker/relayer responsibility. The browser does not receive merchant or agent private keys merely to render a demo.

Existing wire conventions remain: canonical unsigned decimal strings for chain IDs, monetary atoms, nonces and on-chain times; validated hex addresses/hashes/calldata/signatures; separate ISO observation times. UI strings convert exactly to token atoms using configured decimals. Reject out-of-range or excess decimal precision instead of rounding a value before it is signed.

The authoritative EIP-712 types and hashes come from implemented code plus cross-language tests. Do not create alternate types in this document or copy main's old prototype intent.

## 2. Read-model repairs that unblock UI

B1 must resolve INT-007/008 from the audit against actual code. The response for an executed payment must join the policy, intent and artifacts that actually executed, not whichever policy or intent is now active.

| Value | Required source/behavior |
|---|---|
| `authorized.inputToken`, `authorized.routeId` | Executed/selected intent's immutable policy configuration, never hardcoded null |
| `authorized.maxInputAtomic` | That intent's signed bound, not a fresh quote |
| `settlement.actualInputAtomic`, delivered output | Canonical expected PaymentExecuted evidence with matching token/recipient/route and successful receipt |
| `observedAt.blockNumber`, `blockHash`, `canonical` | Corresponding block/receipt observation, with real nullability before observation |
| Transaction sender/nonce/replacement | Actual journal and receipt joins; replacement means transaction hash, not row UUID |
| Timeline evidence | Stable IDs plus documented tx/block/canonical fields; retain preflight and escalation history |
| Policy and vault values | Clearly identified observed chain state; do not silently show old cached balances as current |

If an operation has no settlement yet, return null for the whole settlement object as specified. Do not produce a "settled" object with fabricated or unexplained null mandatory fields. Schema validation must test response values and business relationships, not only TypeScript declarations.

Do not add a dashboard analytics service. Count loaded rows honestly, or use a small existing authorized query for actual totals. Avoid claiming a complete aggregate from the first page of a paginated list.

## 3. Contract/package/configuration identity

`@payguard/integration` already exists in the audit. Extend its actual exports rather than creating another SDK. It should contain browser-safe API client/models, wire validators, signed-type descriptors/encoding utilities, generated ABI/error/event definitions, and exact formatting helpers where already appropriate.

Keep `/v1/config` public and secret-free. It supplies the configured chain/deployment, tokens and declared decimals/mock labeling, route identities and ABI/schema version. Owner vault addresses come from authorized vault discovery. Wallet-provider project configuration, when actually required, is distinct from chain authority.

Validate configured deployed code/bindings and artifact provenance before enabling a route. Unknown or absent code must not become usable because a route is listed in JSON. A code hash recorded after deployment is useful evidence only when connected to the selected compiled/deployed artifacts and constructor configuration; do not treat an arbitrary observed hash as proof of trusted code.

Do not add a fictional ABI-introspection RPC. Keep manifest/code checks, ABI generation drift tests and actual required view calls. Expose only tested usable route capabilities. A configured but unavailable route returns a clear unavailable result and must not silently fall back to direct transfer or another protocol.

## 4. Browser authentication and reload

Use one browser-visible origin for the owner app and `/v1` through the actual chosen local proxy/serving arrangement. Match SIWE domain/URI, allowed Origin, cookie attributes, credential behavior and CSRF. Test the real configuration, not only Fastify injection.

Preserve the existing auth endpoints. A browser logs in using the stored server challenge. Do not accept a replacement challenge message from the browser. Cookie login and agent bearer login are distinct delivery modes, not self-assigned roles.

B1 must inspect how an authenticated browser restores identity and CSRF after reload. If the current interface lacks a safe recovery read, record and implement a minimal authenticated session-read endpoint (suggested `GET /v1/auth/session`) with explicit schema and tests. This endpoint is **proposed only**, not an existing API promise. An alternative is an explicit re-login that preserves payment IDs and never replays pending payments. Do not silently make logout/reload destroy durable payment recovery.

Reject untrusted origins on mutations and, where applicable, on session/bootstrap operations. Do not solve local auth by disabling verification or using wildcard credentialed CORS. An explicitly development-only cookie option is not a production default; prefer a tested single-origin HTTPS setup when required by the chosen cookie policy.

The frontend invalidates pending signing/prepared actions on account, chain, deployment or ABI/schema mismatch. On reload it may retain non-secret payment/operation IDs, keyed by owner/deployment. Never persist private keys, session bearer tokens or approval signatures in ordinary localStorage. An old ID is not authorization; server access checks always apply.

## 5. Bounded demo actor bridge (new, B2-owned)

Purpose: retain the colleague's useful scenario controls without retaining the fake Express ledger. The bridge triggers actual merchant/agent signing and normal `/v1` payment flow. It never writes successful payment status or bypasses authentication/contract checks.

Prefer the existing runner/module patterns; a new general microservice is not required. When a browser trigger is needed, use a small demo-only same-origin bridge with the following proposed operations. If a current equivalent already exists, reuse it and document its exact published path in API_CONTRACT and the B2 handoff.

| Proposed endpoint | Authority | Responsibility |
|---|---|---|
| `GET /v1/demo/scenarios` | Authenticated owner | Return available controlled scenarios and that owner's validated demo profiles |
| `POST /v1/demo/runs` | Owner cookie + CSRF + idempotency | Create one durable run and initiate only a permitted named scenario |
| `GET /v1/demo/runs/{id}` | Same owner/deployment | Return stable payment/intent/operation references and orchestration outcome |

Suggested catalog fields, to finalize in code/tests in B2:

```text
DemoProfile:
  profileId, label, deploymentId, vaultId,
  policyResourceId, onchainPolicyId, agentAddress,
  routeId, routeKind, inputToken, outputToken, available

Scenario:
  scenarioId, label, description, permittedProfileIds,
  invoiceAmountAtomic, requiresSourcePayment

DemoRun:
  runId, deploymentId, profileId, scenarioId,
  operationId, paymentId|null, intentId|null,
  orchestrationStatus, errorCode|null
```

Normal start request: `{profileId, scenarioId}`. A duplicate/retry scenario additionally references the exact existing `sourcePaymentId`; do not accept arbitrary recipient, private key, router calldata, signature target or program bytes. Shape this as a validated discriminated union, not a permissive bag of optional fields.

Named scenarios include a safe compute invoice, an approvable hotel invoice, an over-hard-budget request, a controlled unauthorized-merchant proposal, and a duplicate attempt. The bridge signs only with isolated demo merchant/agent credentials for pre-enrolled owner/profile relationships. API and worker must never receive owner private keys.

If a scenario needs a signed attacker invoice, use a clearly separate seeded demo actor. If the public API rejects it before creating a payment, record that actual API rejection as orchestration evidence, not a fabricated chain BLOCK. Do not bypass a validation layer to make a more theatrical screen.

Idempotency for a lost response must recover the same run/invoice/intent/operation. A new intentional purchase can create a new invoice. A duplicate test must deliberately reuse the original invoice identity. An ESCALATE run stops pending an owner signature; the helper may not impersonate the owner or auto-approve.

Persist only the additional orchestration state needed. Reuse existing operation/result and outbox machinery when suitable; add a small forward `demo_runs` migration only if durable mapping cannot be represented cleanly. Never create a second business ledger.

Gate the bridge with an explicit demo flag, owner authorization, and an allowlisted local chain/deployment. Treat it as unavailable outside the controlled demo configuration. Do not trust a user-supplied boolean or environment label alone to authorize key usage. No public reset or unrestricted signing endpoint.

## 6. Profiles, policies and routes

The required showcase has two separate route-bound policies for distinct agent profiles/keys. Both may belong to one owner vault if the actual immutable adapter configuration supports that; otherwise use explicitly distinct configured vaults. Never invent a shared budget spanning independent policies/vaults.

Existing deployments may need replacement to bind new immutable adapters. Reuse the vault CODE, not necessarily the same deployed address. Record the new manifest, create intended policies and sign new artifacts against the actual domain. Do not mutate old approvals into the new route.

No automatic route failover for signed payment execution. A retry uses the same business obligation; changed protected intent fields require a valid new intent and, where required, a new owner approval. Success on a different route cannot bypass consumed invoice identity.

## 7. Status and display contract

Preserve the current four axes: policyDecision, executionStatus, confidence, reconciliation. A initial ESCALATE followed by successful execution remains visible in the timeline even if current evaluation later becomes ALLOW.

The paid view requires successful expected canonical receipt/event evidence, `executionStatus=SUCCEEDED`, `reconciliation=MATCHED`, a valid settlement object and the selected confidence policy. LOCAL_DEMO is not public-chain finality. INCLUDED alone, a returned tx hash, a successful POST, an estimate or an animation does not meet this condition.

UNKNOWN remains unresolved. A reorg clears/recomputes current settlement while retaining historical orphan evidence. A reconciliation mismatch warns and stops resubmission. A preflight BLOCK may have no tx hash; never invent an on-chain denial log.

The frontend can map these axes into simple badges but must retain the distinctions in data and details. Every displayed "verified" step needs real evidence; show a policy summary instead of inventing individual check results.

## 8. What is flexible

Component names, local presentation state, navigation, layout, polling implementation, exact demo helper module placement and small error-display mappings are flexible. Existing framework choices are preserved unless a concrete compatibility issue requires a narrow change.

New shared fields/endpoints, signing types, auth semantics, route authority, migrations and contract behavior require explicit coordinated decisions, implementation and tests. Frontend limitations do not justify weakening the existing vault.
