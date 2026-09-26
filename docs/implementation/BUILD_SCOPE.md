# PayGuard build scope

Recorded at Stage 1 per `PAYGUARD_BUILD_PROMPTS.md` selected scope table and the START/SELECTED OUTCOME section of Prompt 1.

## Default scope (from prompt pack)

| Capability | Gate status |
|---|---|
| Per-owner vault, owner policies, merchant invoices, agent intents, exact escalation | Required |
| PostgreSQL, authenticated API, durable worker, transaction recovery, read models | Required |
| Direct transfer inside the vault | Required reference path |
| Real local v4 exact-output settlement | Required showcase path |
| Merchant subsidy with NONE / REQUIRED / BEST_EFFORT behavior | Required, but scoped to **Stage 6** — not built in Stage 1 |
| Independent Aqua/SwapVM taker adapter | Not selected unless explicitly enabled before its build gate |
| Serial Aqua/SwapVM -> v4 custom-opcode settlement | Not selected; requires a separate approved design and proof |
| Public-testnet deployment | Optional, explicitly gated; local execution must still work |
| Live ERC-7715, ENS, World, KMS, public webhooks, exact-slot manifests | Not selected |
| Frontend pages, components, styling, dashboard implementation | Out of scope |

## Stage 1 scope (this stage only)

In scope:
- Repository/tool inventory and docs/implementation scaffolding.
- Build graph resolution (Node/TS/Fastify/viem/pg/PostgreSQL/OpenZeppelin/Foundry) against what is actually installable, with recorded deviations.
- Monorepo scaffold: `apps/api`, `apps/worker`, `packages/domain`, `packages/db`, `packages/chain`, a public integration package, test utilities, `contracts/core-v4`. `contracts/aqua` is NOT created (Aqua not selected) — its future boundary is documented below instead.
- `./scripts/payguard verify-stage 01` dispatcher.
- Real Uniswap v4-core PoolManager fixture proving a bare exact-output swap and one bounded failure case, independent of the PayGuard vault/kernel (that's Stage 2). Proven two ways: inside forge test's own EVM (`contracts/core-v4/test/V4SwapFixture.t.sol`, fast/primary correctness proof) AND against a literal spawned `anvil` process over real JSON-RPC (`contracts/core-v4/script/DeployFixture.s.sol` broadcast + `packages/chain/test/v4-anvil-fixture.test.ts`), satisfying "start an isolated local Anvil instance" literally, not only via forge's built-in test EVM.
- Shared schemas (PolicyConfig, MerchantPermission, Invoice, PaymentIntent, ExceptionApproval, Evaluation, PaymentView, Operation, Observation) as machine-checkable types.
- EIP-712 domain/type descriptors, a TypeScript encoder, and an independent Solidity hashing harness producing cross-language vectors (matching digests) plus negative vectors (wrong-domain, changed-field must NOT match).
- SPEC-### decisions for the reconciliation questions listed in Prompt 1 item 5.

Out of scope for Stage 1 (explicitly deferred to later stages per the stage map):
- The actual `PayGuardVault` contract, authorization kernel, policy/invoice/intent consumption logic — Stage 2.
- PostgreSQL migrations actually applied against a running instance and DB-level tests — Stage 3 (Stage 1 only installs/starts PostgreSQL and proves connectivity; no domain schema is migrated yet beyond what's needed to prove the DB tool works).
- Fastify API handlers, authentication, SIWE — Stage 4.
- Worker/relayer/indexer — Stage 5.
- Merchant subsidy hook and Aqua adapter — Stage 6 and beyond.
- Any UI.

## Aqua/SwapVM boundary (not selected)

Aqua is an independent optional adapter, not an assumed serial bridge to v4 (CLAUDE.md, ARCH D09/3.3 "Aqua/SwapVM alternative adapter", REVIEW verdict). Its isolated future boundary: `contracts/aqua/` would hold a separate Foundry project pinning SwapVM `v1.0.2` (solidity `0.8.30`), Aqua `0.1.0`, solidity-utils `6.9.7`, OpenZeppelin `5.4.0`, forge-std `v1.11.0` (ARCH 3.0/3.3), deployed to the same local Cancun EVM but never compiled in the same compilation unit as `contracts/core-v4` (which pins Solidity `0.8.26`). It would talk to PayGuard only through the `IPayGuardSettlementAdapter.settle()` boundary already defined in `reference/CONTRACT_INTERFACE.sol`. Not installed in Stage 1: no unused second stack was added.

## Authority/environment choices recorded here (not asked as questions — resolvable from evidence)

- API and worker processes never hold an owner private key (CLAUDE.md invariant, ARCH 3.1). Stage 1 env templates separate `RELAYER_PRIVATE_KEY` (local dev only, worker-owned) from any owner/agent/merchant fixture keys, none of which are "the" human owner key — all Stage 1 fixture keys are Anvil's well-known local dev keys, disposable.
- Local demo chain: Anvil, explicit `cancun` hardfork, distinct local chain ID (ARCH D07, 3.3).
- v4-core pinned to inspected commit `d153b048` per ARCH 3.3/3.0; Solidity `0.8.26`, Cancun.

## Acceptance matrix (Stage 1 required checks -> where proven)

| Required check | Proof location |
|---|---|
| Reproducible package installation, compiler/typecheck execution | `DEPENDENCIES.md`, `pnpm-lock.yaml`, `./scripts/payguard verify-stage 01` |
| Real local v4 exact-output swap + negative case, receipt/balance evidence | `contracts/core-v4/test/V4SwapFixture.t.sol`, forge test output in checkpoint 01 |
| Cross-language signed-type hash vectors incl. wrong-domain/changed-field rejection | `packages/domain/test/eip712-vectors.*`, `contracts/core-v4/test/Eip712Vectors.t.sol` |
| Bounded-policy scope, resolved source map, traceable acceptance matrix | this file, `SOURCE_MAP.md`, `TRACEABILITY.md` |
| No UI, no public deployment, no invented integrations, no unresolved required ABI/type ambiguity | manual review at checkpoint; INTERFACE was present (not missing), so no drafted ABI details were needed |
