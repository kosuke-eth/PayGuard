# Backend handoff (updated through B5): demo bridge + both sponsor routes, for the frontend (F-gate) integration

Status: backend-only, CLI/HTTP-inject proven (`app.inject()` and real local Anvil/Postgres, no
mocks). Real browser wallet behavior (extension/injected-provider signing, actual SIWE/CSRF from a
page) is **not** proven by this document or by any backend test suite — that is explicitly F1-F3
scope, not B0-B5. See section 9. Do not start frontend work from this document without first
reading `docs/PAYGUARD_INTEGRATION_BOUNDARY.md` (the authoritative boundary spec this document
implements) and `docs/API_CONTRACT.md` (the authoritative endpoint contract).

**What changed since the original B2 version of this document:** both required sponsor routes are
now real, tested, independent settlement paths through the actual API/worker/vault/DB path — real
Uniswap v4 (`contracts/core-v4/src/adapters/PayGuardV4Adapter.sol`, B3) and real 1inch Aqua/SwapVM
maker-liquidation (`contracts/aqua/src/PayGuardAquaAdapter.sol`, B4). B5 added: a single coherent
demo deployment provisioning direct+v4+Aqua together (`apps/api/scripts/demo-setup.ts`), real
owner-approved ESCALATE and real on-chain-infeasible-swap coverage for both sponsor routes through
the actual HTTP→worker→chain path, and a real functional test of the previously-untested
`GET /v1/payments/{id}/timeline` endpoint. See `docs/implementation/checkpoints/B3.md`,
`B4.md`, and `B5.md` for the full evidence trail.

## 1. Install, start, test

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint

# Local Postgres 17 (idempotent) + migrate the dev database once:
./scripts/payguard db:start
DATABASE_URL=postgresql://payguard:payguard_local_dev@127.0.0.1:5432/payguard_dev \
  pnpm --filter @payguard/db migrate

# Local Anvil, chain id 31337 (separate terminal, stays running):
anvil --port 8545 --chain-id 31337 --hardfork cancun

# Provision one COHERENT demo deployment: one owner, real deployed direct-route MockERC20 pair,
# a real Uniswap v4 pool + PayGuardV4Adapter, and a real 1inch Aqua/SwapVM pool + maker strategy +
# PayGuardAquaAdapter -- three vaults, three ACTIVE policies, one merchant/invoice signer identity
# reused across all three. Safe to rerun -- reuses the existing deployment (all three vaults) if
# Anvil/DB state still matches; only reseeds/redeploys what's actually missing:
DATABASE_URL=postgresql://payguard:payguard_local_dev@127.0.0.1:5432/payguard_dev \
RPC_URL=http://127.0.0.1:8545 \
  pnpm --filter @payguard/api exec tsx scripts/demo-setup.ts
```

The script prints one block of env vars per route (DIRECT / V4 / AQUA): `PAYGUARD_DEPLOYMENT_ID`,
`PAYGUARD_DEMO_ENABLED=true`, `DEMO_AGENT_PRIVATE_KEY`, `DEMO_MERCHANT_PRIVATE_KEY`,
`DEMO_UNAUTHORIZED_MERCHANT_PRIVATE_KEY`, plus each route's vault/policy/adapter/route identifiers.
Set the env vars (plus the usual `DATABASE_URL`, `RPC_URL`, `CHAIN_ID=31337`, `API_SIWE_DOMAIN`,
`API_SIWE_URI`, `API_ALLOWED_ORIGINS`, `RELAYER_ADDRESS` config `apps/api` already requires) on
the API process, then:

```bash
pnpm --filter @payguard/api run dev     # apps/api/src/main.ts
pnpm --filter @payguard/worker run dev  # separate terminal
```

Automated tests (real Postgres + Anvil, no mocks):

```bash
pnpm --filter @payguard/api exec vitest run test/demo.test.ts        # B2 demo-bridge suite (DIRECT route), 17 cases
pnpm --filter @payguard/api exec vitest run test/v4Route.test.ts     # B3+B5: real v4 ALLOW/ESCALATE/infeasible-swap
pnpm --filter @payguard/api exec vitest run test/aquaRoute.test.ts   # B4+B5: real Aqua ALLOW/ESCALATE/infeasible-fill
pnpm --filter @payguard/api exec vitest run                          # full apps/api suite -- 130 cases as of B5
pnpm --filter @payguard/worker exec vitest run                       # fault/recovery matrix -- 21 cases as of B5
pnpm --filter @payguard/domain test                                   # incl. deployment-binding invariant
pnpm --filter @payguard/integration exec vitest run                   # browser-bundle-safety + boundary + contract-drift
./scripts/payguard verify-mvp B5                                      # everything above (both routes), one command
```

Do not run `apps/api`'s and `apps/worker`'s vitest suites concurrently in separate terminals --
both point at the same `payguard_test` Postgres database and each suite's own harness truncates it
at startup (`apps/api/vitest.config.ts` and `apps/worker/vitest.config.ts` both set
`fileParallelism:false` for the same reason, within a single package; that guard does not extend
across packages). Run one to completion before starting the other.

## 2. Origins, proxy, auth requirements

Identical to every other authenticated route (`docs/PAYGUARD_INTEGRATION_BOUNDARY.md` section 2-3
already covers this in full; nothing demo-specific changes it):

- `POST /v1/demo/runs` mutates and is called by the **owner's BROWSER session** — httpOnly cookie
  (`payguard_session`), `X-CSRF-Token` header matching the session's stored CSRF hash, and an
  `Origin` header present in `API_ALLOWED_ORIGINS`. A same-origin deployment (frontend served from
  the same origin as the API, or reverse-proxied to appear so) is required; there is no CORS
  allowance for a cross-origin browser session.
- `GET /v1/demo/scenarios` and `GET /v1/demo/runs/{id}` are reads and accept either session kind
  (BROWSER cookie or AGENT bearer), same as every other authenticated GET.
- SIWE login (`POST /v1/auth/challenges` → sign → `POST /v1/auth/verify`) is unchanged and is how
  the owner's browser session is established before any of the above.
- Outside `PAYGUARD_DEMO_ENABLED=true` + `environment === 'LOCAL_DEMO'` + `chainId === 31337`
  (all three, not any one), every demo route returns `RESOURCE_NOT_FOUND` — it does not exist as
  far as an HTTP client can tell.

## 3. Public-package imports and generation commands

Everything a frontend needs is exported from `@payguard/integration` (`packages/integration/src/
index.ts`) — never import `@payguard/db` or `@payguard/chain` directly (enforced by
`packages/integration/test/boundary.test.ts`).

```ts
import { createPayGuardClient, DEMO_RUN_START_BODY } from '@payguard/integration';

const client = createPayGuardClient({ baseUrl: origin, csrfToken, fetchImpl: fetch });
const { scenarios, profiles } = await client.listDemoScenarios();
const run = await client.startDemoRun({ profileId, scenarioId: 'compute' }); // idempotencyKey via options
const polled = await client.getDemoRun(run.runId);
```

`createPayGuardClient`'s `PayGuardClientOptions` (`accessToken`, `csrfToken`, `idempotencyKey`,
`fetchImpl`) match the existing client — nothing new to learn there. No new codegen step: the
demo routes' request schema (`DEMO_RUN_START_BODY`) is drift-tested against `apps/api`'s own copy
(`apps/api/test/contract-drift.test.ts`) exactly like every other shared schema, so a divergence
between the published contract and the running handler fails CI, not silently drifts.

## 4. Config, vault and profile discovery

1. `GET /v1/config` (public, no auth) — chain id, mock token list, and the deployment's real
   configured+enabled route list. A demo profile's `routeKind`/`available` is always consistent
   with what this endpoint already advertises; never trust a demo profile that claims a route not
   listed here.
2. SIWE login as the owner (BROWSER session) — see section 2.
3. `GET /v1/demo/scenarios` — the fixed 5-scenario catalog, plus `profiles`: every demo-eligible
   policy on vaults the caller owns, scoped to THIS deployment only. `available:true` is required
   before `profileId` may be used in `POST /v1/demo/runs`; an unavailable profile (route not
   enabled, or policy not `ACTIVE`) is rejected server-side (`RESOURCE_FORBIDDEN`) even if a client
   tries anyway.

As of B5 there are THREE demo profiles in the reference local setup (`scripts/demo-setup.ts`
provisions one policy per route: DIRECT, V4, AQUA), each on its own vault, each independently
`available:true` once its route is configured+enabled in `GET /v1/config` and its policy is
`ACTIVE`. `getDemoProfilesForOwner` (`apps/api/src/demo/catalog.ts`) derives a profile from ANY
active policy on ANY vault the caller owns, generically by `routeKind` read off the deployment's
own `configuration.routes[]` — it is not hardcoded to the direct route. A frontend must render
`profiles` as a real list (never assume length 1), and should use each profile's own `routeKind`
(`DIRECT`/`V4`/`AQUA`) to label the option, not infer it from ordering.

**Important scope boundary, read before wiring a route picker into the demo bridge UI:** the 5
fixed demo SCENARIOS (compute/hotel/over_budget/unauthorized/duplicate,
`apps/api/src/routes/demo.ts`) build their invoice/intent generically off whichever profile is
selected (`profile.outputToken`, `profile.routeId`, `profile.onchainPolicyId` — confirmed by
reading the handler, not assumed), so running a scenario against a V4 or AQUA profile is
architecturally supported. However, **no test has actually exercised `POST /v1/demo/runs` with a
V4 or AQUA `profileId`** — `test/demo.test.ts`'s harness only provisions a DIRECT-route vault. The
route-agnostic behavior described above is inspected-and-plausible, not measured. What IS measured
for V4/Aqua is the direct `payment-intents` API path below (B3/B4/B5's `test/v4Route.test.ts` and
`test/aquaRoute.test.ts`), which is the real, currently-recommended integration path for those two
routes. Treat "V4/Aqua through the demo bridge's scenario catalog" as unproven until a test (or a
real frontend session) exercises it.

## 4a. Direct v4 / Aqua payment flow (proven path, outside the demo bridge)

This is what `test/v4Route.test.ts` and `test/aquaRoute.test.ts` actually exercise end to end —
the plain `payment-intents` API, not `/v1/demo/runs`. Use the profile discovered in section 4
(`routeId`, `onchainPolicyId`/`policyResourceId`, `vaultId`) to build the invoice/intent instead of
the demo bridge's canned scenario amounts:

```ts
import { callPayGuardApi } from '@payguard/integration';

const options = { baseUrl: origin, accessToken, csrfToken };
// 1. Merchant-signed invoice against the CHOSEN profile's vault/settlement token.
const { invoiceResourceId } = await callPayGuardApi(options, 'POST', '/v1/invoices', {
  vaultId: profile.vaultId, invoice, merchantSignature,
});
// 2. Agent-signed intent bound to the profile's own routeId/onchainPolicyId.
const { paymentId, intentId, evaluation } = await callPayGuardApi(
  options, 'POST', '/v1/payment-intents',
  { invoiceResourceId, policyResourceId: profile.policyResourceId, intent, agentSignature },
);
// evaluation.decision is ALLOW, ESCALATE, or BLOCK -- ESCALATE needs the owner-approval flow in
// section 6 before the next step; BLOCK stops here (never submit a BLOCKed intent).
await callPayGuardApi(options, 'POST', `/v1/payment-intents/${intentId}/submit`, {});
// 3. Poll GET /v1/payments/{paymentId} (section 7's terminal-state contract) for the real result.
```

A real on-chain-infeasible swap/fill (e.g. an agent-chosen `maxInputAmount` too low for the actual
route cost) is never silently reported as success. The real worker (`submitPayment.ts`)
static-calls `executePayment` before ever broadcasting or reserving a nonce; when the underlying
adapter's own threshold check would revert (`MaxInputExceeded` on v4, `MaxInputExceededAtCallback`
on Aqua), that surfaces as `executionStatus: "CANCELLED"`, `reasonCode: "SIMULATION_REJECTED"` --
no gas spent on a doomed broadcast, no budget/counter consumption, and never a fabricated success
or a partial delivery. This is the "failed-swap"/"failed-strategy" case referenced elsewhere in
this document and in the B5 checkpoint.

## 5. Endpoint shapes, result and error examples

Full field-level contract lives in `docs/API_CONTRACT.md`'s new "Demo bridge (B2)" section — this
is illustrative, not a competing source of truth.

**Start a run (ALLOW path):**

```http
POST /v1/demo/runs
Cookie: payguard_session=...
X-CSRF-Token: ...
Origin: https://demo.payguard.example
Idempotency-Key: 3f9c...
Content-Type: application/json

{"profileId":"<uuid>","scenarioId":"compute"}
```

```json
{
  "data": {
    "runId": "b1a2...",
    "deploymentId": "803083d6-...",
    "profileId": "bc42e3e9-...",
    "scenarioId": "compute",
    "stage": "submit",
    "orchestrationStatus": "QUEUED",
    "errorCode": null,
    "paymentId": "9c11...",
    "intentId": "44aa...",
    "operationId": "7bd0..."
  },
  "requestId": "..."
}
```

**Real rejection (over_budget, BLOCK at the intent stage, never submitted):**

```json
{
  "data": {
    "runId": "...",
    "stage": "intent",
    "orchestrationStatus": "BLOCKED",
    "errorCode": "TOTAL_OUTPUT_BUDGET",
    "paymentId": "...",
    "intentId": "...",
    "operationId": null
  },
  "requestId": "..."
}
```

**Transport-level error (unknown scenarioId, wrong owner, missing idempotency key, etc.) uses the
standard failure envelope, same as every other route:**

```json
{ "error": { "code": "RESOURCE_FORBIDDEN", "message": "...", "retryable": false, "requestId": "..." } }
```

## 6. Owner action / signing examples (ESCALATE approval — never bridge-auto-approved)

A `hotel` scenario run returns `orchestrationStatus: "AWAITING_APPROVAL"`. The bridge does **not**
have an auto-approve shortcut; the owner must sign the real exact approval through the normal API,
exactly as any other ESCALATE payment would require:

```ts
import { callPayGuardApi } from '@payguard/integration';

const options = { baseUrl: origin, accessToken, csrfToken };
const { typedData } = await callPayGuardApi(
  options, 'GET', `/v1/payment-intents/${intentId}/approval-typed-data`,
);
const ownerSignature = await ownerWalletClient.signTypedData(typedData); // real wallet signature
await callPayGuardApi(options, 'POST', `/v1/payment-intents/${intentId}/approvals`, {
  approval: typedData.message, ownerSignature,
});
await callPayGuardApi(options, 'POST', `/v1/payment-intents/${intentId}/submit`, {}); // resubmit after approval
```

`createPayGuardClient` does not yet wrap the approval-typed-data/approvals/submit endpoints as
named methods (only `listDemoScenarios`/`startDemoRun`/`getDemoRun` were added for B2) — use the
generic `callPayGuardApi(options, method, path, body)` export shown above, exactly the same
request/response contract documented in `docs/API_CONTRACT.md`'s existing payment-intents section.
Adding named wrappers for those three routes is a small, independent follow-up, not specific to
the demo bridge.

**Auth requirement, confirmed by re-reading `requireIntentAccess` in
`apps/api/src/routes/paymentIntents.ts` while building B5's own test coverage:** both
`approval-typed-data` (GET) and `approvals` (POST) require `isOwner`, computed strictly as
`loaded.ownerWalletId === auth.walletId` — the agent's bearer token is never sufficient, regardless
of session kind, because it authenticates the AGENT's wallet, not the vault owner's. In practice
this means the owner must be logged in as themself (their own SIWE-derived session) when calling
these two routes; a page that only holds an agent's bearer token cannot complete an approval no
matter how it's called. This is route-agnostic — identical for DIRECT, V4, and AQUA policies; there
is nothing route-specific in the approval flow.

## 7. Polling and reload behavior

`GET /v1/demo/runs/{id}` recomputes `livePaymentStatus` from the current `payments` row on every
call — it is not a cached/frozen snapshot of the original orchestration outcome. Poll it after a
`QUEUED` or `AWAITING_APPROVAL` result until `livePaymentStatus.executionStatus` reaches a terminal
state (`SUCCEEDED`/`REVERTED`/`CANCELLED`). A page reload can safely re-fetch
`GET /v1/demo/runs/{id}` with the `runId` kept in the URL/local state; there is nothing else to
reconstruct client-side.

## 8. Credential placement

- **Never** in the browser, in any frontend bundle, in localStorage, or in any request body/query
  string: the owner's private key, `DEMO_AGENT_PRIVATE_KEY`, `DEMO_MERCHANT_PRIVATE_KEY`,
  `DEMO_UNAUTHORIZED_MERCHANT_PRIVATE_KEY`.
- The owner signs with their real wallet (browser extension / injected provider) for SIWE login
  and for any ESCALATE approval — the frontend never holds or transmits an owner key.
- `DEMO_*_PRIVATE_KEY` env vars belong only on the API process's own environment (server-side),
  read once at config load (`apps/api/src/config.ts`'s `loadDemoConfig`) and used only inside
  `apps/api/src/routes/demo.ts`'s orchestration — never logged, never echoed in any response body.
- The owner's real private key exists only inside `scripts/demo-setup.ts` / `scripts/demo-reset.ts`
  processes (via `@payguard/test-utils`'s well-known local Anvil dev key), which exit immediately
  after provisioning and are never imported by the running API/worker.

## 9. Endpoints the visible UI does not need

`test/openapi-drift.test.ts`'s `required` list is the 26-endpoint inventory `docs/API_CONTRACT.md`
documents as the core backend surface (this count excludes the demo bridge's own
`/v1/demo/scenarios`, `/v1/demo/runs`, `/v1/demo/runs/{id}` — those are additive, B2-introduced,
and ARE needed for the demo UI). Of the 26, the golden-path UI (login, view vault/policies, pay via
a profile, approve an ESCALATE, watch a payment settle) needs:

`GET /v1/config`, `POST /v1/auth/challenges`, `POST /v1/auth/verify`, `POST /v1/auth/logout`,
`GET /v1/vaults`, `GET /v1/vaults/{id}`, `GET /v1/policies/{id}`, `POST /v1/invoices`,
`POST /v1/payment-intents`, `GET /v1/payment-intents/{id}/approval-typed-data`,
`POST /v1/payment-intents/{id}/approvals`, `POST /v1/payment-intents/{id}/submit`,
`GET /v1/payments/{id}`, `GET /v1/payments/{id}/timeline`, `GET /v1/payments`,
`GET /v1/operations/{id}` (for polling a queued submission's status).

The remaining 10 are real, tested, and documented in `docs/API_CONTRACT.md`, but are
operator/setup/audit surface, not required for the golden-path UI a reused frontend needs to show:

- `POST /v1/vaults/{id}/transactions` — owner deposit/withdraw preparation. Used once during setup
  (`scripts/demo-setup.ts` calls it directly); a UI MAY optionally expose "add funds" through it,
  but nothing in the approval/payment golden path requires it.
- `POST /v1/policy-drafts`, `PUT /v1/policy-drafts/{id}`, `POST /v1/policy-drafts/{id}/transaction`
  — policy creation. The reference demo deployment provisions its policies once via
  `scripts/demo-setup.ts`, not through a running frontend session.
- `POST /v1/chain-observations` — indexer/observation ingestion; backend-internal, never called
  from a browser.
- `POST /v1/policies/{id}/revocation-transaction` — owner policy revocation; an advanced operator
  action outside the demo's golden path.
- `GET /v1/transactions/{hash}` — audit/debug lookup by raw transaction hash; a power-user tool,
  not part of the core flow (payment detail already carries its own settled transaction hash).
- `GET /health/live`, `GET /health/ready` — infrastructure probes, never called by a browser.

## 10. Pending browser tests (explicitly not covered by this handoff)

- No real browser (extension or injected-provider wallet) has exercised SIWE login, the ESCALATE
  approval signature, or `POST /v1/demo/runs`'s CSRF/Origin path — everything through B5 is proven
  via `app.inject()` (in-process HTTP-equivalent calls) and direct wallet-account signing in tests,
  not an actual browser. A CLI signature proving a digest is correct is not proof of real browser
  wallet behavior (account/network switches, extension popup flows, cookie/CSRF handling under an
  actual fetch call from a page). This is F1-F3 scope (`docs/PAYGUARD_FRONTEND_PROMPTS.md`), not
  something this document or any backend test can close.
- Both sponsor routes (Uniswap v4, Aqua/SwapVM) are proven through the real API/worker/vault/DB
  path via the direct `payment-intents` API (section 4a) — ALLOW, owner-approved ESCALATE, and a
  real infeasible-swap/fill rejection, all for both routes. They are NOT proven through the demo
  bridge's `/v1/demo/runs` scenario catalog (section 4's scope boundary) — that remains
  architecturally-supported-but-untested.
- `demo-reset.ts` has not been exercised against a frontend that is actively polling
  `GET /v1/demo/runs/{id}` during a reset — the expected behavior (a stale `runId` from before the
  reset now 404s under the new deployment) is a consequence of the deployment scoping fix documented
  in `checkpoints/B2.md`, but has not been observed from an actual running frontend session.
- No visual/UI test and no full-product (login → pay → approve → settle, in an actual browser) test
  has been run. Track these as F1-F3, not passing, per the B5 prompt's own gate language.
