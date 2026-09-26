## 3. Full rebuilt architecture

### 3.0 Scope and decision register

**Chosen product:** an owner funds a per-owner vault, authorizes an agent to choose among explicitly permitted merchants under hard budgets, and approves only payments that exceed an automatic per-payment threshold. A permitted payment transfers the exact settlement amount. Direct transfer is the reference path; an actual Uniswap v4 exact-output swap is the primary asset-conversion path. Aqua/SwapVM is a separately selectable adapter, not an imaginary automatic v4 routing layer.

This deliberately preserves bounded autonomous choice. A mandatory exact-invoice Spend Lockfile would change the original product. Exact preapproved slots remain an optional stricter authorization mode, with corrected hashing described below. Replacing the original serial Aqua-plus-v4 route with alternative adapters is also an explicit scope change, not a claim that the original combined route has been verified.

All interfaces and SQL below are **new proposed application specifications**. Sources establish the underlying mechanisms; they do not establish that these new interfaces already exist or have passed an integration test. The proposed implementation and deployment acceptance are recorded as open verification item O13.

| Decision | Chosen design | Retrieved basis and boundary |
|---|---|---|
| D01 Authorization | Owner-created bounded policy, authenticated merchant invoice, agent-signed exact execution; optional exact-slot mode later | EIP-712 supplies typed signatures, not replay storage or product semantics. [EIP712] [OZ_SIG] |
| D02 Custody | One non-upgradeable vault per owner, full deployment rather than unverified clone tooling | ERC-20 accounts are address balances; eliminates the draft's shared-owner share ledger. [EIP20] [OZ_SAFE] |
| D03 Output budget | Lifetime and fixed-epoch limits in settlement-token base units | No dollar conversion is claimed. [EIP20] [SOL_GLOBALS] |
| D04 Input exposure | One input asset per policy, hard lifetime input budget and per-payment input maximum, both owner-set | Output USDC limits do not mathematically limit raw RWA spend. [EIP20] [EIP712] |
| D05 Approvals | Owner signature can bypass only automatic per-payment cap, up to hard escalation ceiling | Nonce and exact-intent binding are application enforcement. [EIP712] [EIP1271] [OZ_SIG] |
| D06 Relaying | Relayer signs/pays for outer EOA transaction; vault separately verifies agent intent signature | Distinguishes msg.sender, original signer and fee payer. [EIP1559] [EIP2771] [SOL_GLOBALS] |
| D07 Demo chain | Fully local Anvil, explicit Cancun hardfork, real protocol implementations and clearly named mock tokens | Removes stage-time faucet, public-RPC and external-liquidity dependencies. A local fork is not automatically offline. [FOUNDRY_ANVIL] [EIP1153] |
| D08 Public target | Robinhood testnet is an optional deployment target after runtime probes, not assumed ready | Network docs do not prove the desired token/router/pool combination. [RH_CONNECT] [RH_TOKENS] [AQUA_ADDR] |
| D09 Conversion | Fixed-pool v4 adapter first; stock SwapVM taker adapter independently | Their settlement interfaces exist, but composition is new code. [V4_INTERFACE] [SWAPVM_CODE] |
| D10 Subsidy | Optional zero-LP-fee branch plus actual merchant-funded settlement-token donation to in-range LPs | Not equivalent to reimbursing a counterfactual input-token fee; no custom hook-return deltas. [V4_FEE] [V4_INTERFACE] [V4_POOL] |
| D11 API | One Fastify process; worker separate process in same repository | Validation/serialization and durable SQL transactions are verified mechanisms. [FASTIFY_SCHEMA] [PG_CLIENT] |
| D12 Database/queue | PostgreSQL plus SQL outbox; no Prisma, Redis, Kafka or external queue required | SKIP LOCKED and transactions support the chosen small queue. [PG_LOCK] [PG_CLIENT] [BULL_IDEMP] |
| D13 Numeric model | bigint internally, strict decimal strings over HTTP, integral bounded numeric in SQL | Avoid coercion, rounding and floating-point loss. [PG_NUMERIC] [FASTIFY_SCHEMA] [PG_TYPES] |
| D14 Evidence | Exact signed bytes plus parsed JSONB and normalized keys | JSONB is not an original-byte archive. [PG_JSON] [JCS] |
| D15 Status | Policy decision, execution status and chain confidence are separate fields | Confirmation depth is not consensus finality. [RPC_DOC] [ETH_FINALITY] |
| D16 Identity integrations | Native EIP-712 agents; ERC-7715, ENS and World are not execution prerequisites | Permission APIs/records do not supply PayGuard's authorization semantics. [EIP7715] [METAMASK_RPC] [ENS_CODE] |
| D17 Retry unit | One logical invoice payment; multiple signed intents and tx attempts; one consumed invoice key | Nonce/tx identity is not invoice identity. [EIP712] [RPC_CODE] [PG_CONSTRAINT] |
| D18 Deployment lock | Separate compiler/source graphs, exact package versions, actual addresses/ABI/runtime hashes captured after deployment | Exact Solidity pragmas and SDK/deployment drift are real. [SWAPVM_BUILD] [V4_BUILD] [AQUA_ADDR] |

**Selected packages and tools.** These are compatible-by-documented-requirements candidates, not an install/build result. `Node.js 24 LTS`, `TypeScript 5.9.3`, `fastify 5.12.1`, `viem 2.56.3`, `pg 8.20.0`, PostgreSQL `17.11`, and OpenZeppelin Contracts `5.4.0` form the proposed lock baseline. The exact Node patch, container digest, OS-specific Foundry binary hash and transitive npm lockfile remain to be captured during the installation gate, not invented here. No claim is made that every selected older stable release is the newest. [NODE_RELEASE] [TS_PACKAGE] [FASTIFY_PACKAGE] [PG_PACKAGE] [PG_NUMERIC] [OZ_SIG]

A live registry check matters: a retrieved viem repository file said `2.56.4`, while the exact npm endpoint returned 404 and the fresh `latest` response returned published `2.56.3`. Use `2.56.3`, not an unpublished repository version. Its metadata declares TypeScript `>=5.0.4`; the selected TypeScript clears that stated constraint. [VIEM_PACKAGE] [VIEM_SIM_CODE]

Use Foundry's inspected stable release family for build/test/Anvil and record the installed exact release in the build lock. The retrieved release list includes `v1.8.1`; it is a candidate pin, not a claim of local installation. Core/v4 must compile with Solidity `0.8.26`; the inspected SwapVM `v1.0.2` source requires `0.8.30`. Put them in separate build projects, deploy them to the same Cancun-compatible local EVM, and communicate through ABI interfaces. A single compilation unit importing both exact-pragma implementations will not compile. [FOUNDRY_RELEASE] [V4_MANAGER_PIN] [V4_BUILD_PIN] [SWAPVM_CODE] [SWAPVM_BUILD]

### 3.1 Backend

#### Processes, modules and ownership

```text
Human wallet / agent client
        |
        | HTTPS commands, signed artifacts, polling queries
        v
Fastify API ---- short SQL transactions ---- PostgreSQL
        |                                      |
        | evaluation/simulation                | outbox + tx journal
        v                                      v
     RPC client <--------------------------- worker
        |                                      |
        +------- PayGuardVault.execute --------+
                        |
              fixed settlement adapter
                 /                \
             v4 pool         Aqua/SwapVM maker
                        |
                 exact token receipt
```

Use `apps/api`, `apps/worker`, `packages/domain`, `packages/db`, `packages/chain`, `contracts/core-v4`, and `contracts/aqua`. The future frontend depends only on the HTTP contract, typed signing payloads and public deployment configuration. It must not import backend private keys, database code or protocol-specific route construction.

The API has six modules: identity/session verification; policy drafting/preparation; merchant/invoice verification; payment commands and state transitions; chain evaluation/simulation; and authorized read models. The worker owns outbox claims, one dedicated relayer nonce stream, signed-transaction persistence/broadcast, receipt/replacement polling, bounded log scans and reconciliation. These are modules/handlers, not separate microservices. [FASTIFY_SCHEMA] [PG_CLIENT] [VIEM_RECEIPT]

No live LLM response participates in authorization. A fixture-driven agent is sufficient to demonstrate invoice selection, correct signatures and a deliberately malicious proposal. A real model can later generate the same proposal schema without receiving owner privileges. Synthetic merchants must be visibly synthetic until a SuzuPay export/API is actually supplied; importing a data file is not evidence of a live merchant integration.

#### Request validation and signing-safe canonicalization

Every request uses an application-owned JSON Schema with `additionalProperties: false`. On signed-object routes, configure Fastify/AJV with `coerceTypes: false`, `useDefaults: false`, and `removeAdditional: false`. Fastify's ordinary validation defaults can otherwise turn numbers into strings, insert missing fields or delete fields before hashing. Reject those inputs instead of silently changing what the signer supplied. Perform asynchronous authentication and DB ownership checks in the request lifecycle after structural validation, not inside schema compilation. [FASTIFY_SCHEMA] [FASTIFY_CODE]

`uint256` fields must match `^(0|[1-9][0-9]*)$`, contain no exponent/sign/decimal point, and pass an integer bound check against `2^256-1`. Monetary values use token base units. For v4 route inputs/outputs, additionally restrict the relevant values to the supported signed-delta range before casts; the P0 route requires amounts no larger than `2^127-1`. These are validation rules, not estimates of token value. [SOL_ABI] [V4_INTERFACE] [PG_NUMERIC]

Signatures use EIP-712 hashes of typed fields, not arbitrary JSON serialization. Store the original signature, typed fields, computed digest, and exact ABI-encoded field bytes. HTTP idempotency hashes use a fixed schema/version plus the same typed business fields and operation name. Do not include transport-only `requestId` or volatile quote timestamps in payment authority. [EIP712] [SOL_ABI] [PG_JSON]

#### Data flow

1. The owner logs in, funds a vault and configures a policy through a wallet transaction. The backend stores the draft/configuration intent but marks it active only after verified chain observation.
2. A merchant issues a signed invoice. The API verifies its signature and matches recipient/signer/category against the policy snapshot. The agent then signs a PaymentIntent referencing the invoice digest and owner-bounded execution limits.
3. The API inserts the idempotency record, logical payment/intent version and work item in one PostgreSQL transaction. It can evaluate policy through the vault. Evaluation does not reserve funds or promise execution.
4. ALLOW proceeds to full simulation of the exact signed `executePayment` call. ESCALATE produces owner approval typed data and stops. BLOCK stores an observed attempt with its block/reason and does not pretend a chain event exists.
5. After any required owner signature, the worker simulates, signs its own transaction, persists raw bytes/hash/nonce, then broadcasts. The receipt/log tracker updates the read model. Unknown network outcomes remain UNKNOWN until reconciled.

The full signed transaction simulation, not a standalone AMM quote, is the acceptance check for allowances, auth, hook context and token delivery. Before an escalation approval exists, return no executable settlement quote rather than fabricate one; show the owner the exact output and maximum authorized input. Once approval is available, simulation yields the actual route result for that observed state. [VIEM_SIM] [VIEM_SIM_CODE] [EIP140]

#### Error and response model

Successful commands return `201` when a new resource was created or `202` when work remains, with a durable `operationId`/resource ID. Repeating the same principal/operation/idempotency key with the same normalized business request returns the original operation; different business bytes return `409 IDEMPOTENCY_KEY_REUSED`. These are this application's specified HTTP semantics, not a third-party API promise.

```json
{
  "error": {
    "code": "INPUT_BUDGET_EXCEEDED",
    "message": "The requested input ceiling exceeds remaining authorized input.",
    "retryable": false,
    "requestId": "req-example",
    "details": { "remainingInputAtomic": "1000000000000000000" }
  }
}
```

Use `400` for malformed structure, `401` for absent/invalid API authentication, `403` for wrong resource ownership, `409` for version/idempotency/consumption conflict, and `422` for a structurally valid but rejected application operation. An RPC timeout after possible submission returns the existing operation with UNKNOWN submission status, not a fabricated definitive payment failure. Infrastructure errors before an operation exists can use `503` with a retryable code. Preserve raw provider diagnostics only in restricted logs. [FASTIFY_SCHEMA] [VIEM_RECEIPT] [RPC_CODE]

### 3.2 Database

#### Technology and truth boundaries

Use one PostgreSQL database and the `pg` driver with explicit SQL. This is a selection based on the required atomic inserts, row locks, unique/partial indexes and exact numeric storage, not a claim that other databases are incapable. A single checked-out connection owns each SQL transaction; `pool.query` calls cannot be assumed to share a transaction. [PG_CLIENT] [PG_LOCK] [PG_CONSTRAINT]

The separate `DATABASE_SCHEMA.sql` is the proposed schema. It has not been executed against a PostgreSQL server in this session. Key entities:

| Entity | Key/relationship | Purpose |
|---|---|---|
| deployments | UUID; chain ID plus deployment instance | Distinguishes a particular local/testnet installation, even after a same-chain reset |
| wallets | unique 20-byte address | Owner/merchant/agent identity reference, not authority by itself |
| auth_challenges, sessions | wallet FK, one-use challenge, token hash | Web/API login state |
| vaults | deployment + address; owner FK | Per-owner custody contract |
| policy_drafts, policy_draft_revisions | owner/vault + optimistic version; immutable compiled revisions | Mutable preparation and archived signed/submitted preparation, never chain authority |
| policies | vault + on-chain policy ID | Immutable approved configuration and current chain projection |
| policy_merchants | policy + merchant ID | Owner-reviewed recipient/signer/category snapshot |
| signed_artifacts | digest + exact payload bytes + parsed JSON | Invoice, intent and approval evidence |
| invoices | vault + recipient + invoice ID | Stable replay identity across policies/requotes |
| payments | unique invoice FK | One logical obligation, with separate decision/status/confidence |
| payment_intents | payment FK + version; unique digest | Different signed executions for the same obligation |
| approvals | intent FK + owner nonce/digest | Exact signature and cancellation/consumption projection |
| operations | owner/deployment + resource identity | Durable async status for owner transactions and agent submissions |
| signer_state, nonce_families | deployment + relayer + nonce | Durable allocation and fee-replacement grouping |
| transaction_attempts | nonce-family FK + unique deployment/tx hash | Signed raw transaction persisted before broadcast |
| chain_blocks, receipts, chain_events | deployment + branch hashes | Canonical and orphan evidence, not only latest status |
| indexer_cursors | deployment + contract group | Durable next block and ancestry |
| outbox | aggregate/event key + lease/fencing version | Work created atomically with commands |
| payment_timeline | payment FK + unique event identity | Frontend-visible history including uncertainty/reorgs |

Use exact bytes as `bytea`, parsed projections as `jsonb`, timestamps as `timestamptz`, and amounts as the bounded numeric domain. The normalized columns drive constraints; exact signed payload bytes remain the verification evidence. Do not assume JSONB key order or whitespace survives a write/read cycle. [PG_JSON] [PG_NUMERIC]

```sql
CREATE DOMAIN uint256 AS numeric
CHECK (
  VALUE >= 0
  AND VALUE <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
  AND VALUE = trunc(VALUE)
);
CREATE DOMAIN evm_address AS bytea CHECK (octet_length(VALUE) = 20);
CREATE DOMAIN hash32 AS bytea CHECK (octet_length(VALUE) = 32);
```

The domain deliberately omits a fixed scale: `numeric(78,0)` can round a fractional input before an integer check sees it. Add `NOT NULL` to required columns; a CHECK alone does not disallow nulls. Reject non-finite numbers and malformed decimal strings at the API boundary too. Read amount columns as `amount::text`, then parse to bigint when needed. [PG_NUMERIC] [PG_CONSTRAINT] [PG_TYPES]

#### Constraints that change correctness

Use unique `(deployment_id, vault_address)` and `(vault_id, onchain_policy_id)`. Invoices are unique by `(vault_id, recipient, invoice_id)`, not invoice digest: a modified amount produces a different digest but must not become a second payment of the same invoice identifier. A logical payment owns many intent versions; only one unresolved/broadcast execution version is active at a time. A terminal reverted transaction can lead to another attempt without creating another logical payment. On-chain invoice consumption remains the final duplicate guard. [PG_CONSTRAINT] [PG_PARTIAL] [EIP712]

A nonce family is unique by `(deployment_id, sender, nonce)` and has multiple transaction hashes for fee replacement. A canonical mined winner is determined by receipt/block evidence. Store logs uniquely by `(deployment_id, block_hash, log_index)`; retain orphan rows. Use a partial unique canonical block index by `(deployment_id, block_number)` and a partial unique canonical receipt index per tx. Updating branch canonicality and the dependent read model occurs in one SQL transaction. [PG_CONSTRAINT] [PG_PARTIAL] [RPC_CODE]

Create owner/status/created-time indexes on payment lists; invoice/intent digest lookups; sender/nonce and transaction hash lookups; `(status, available_at, id)` for outbox claiming; and deployment/block-range event indexes. No partitioning, sharding or multi-region database is required for the demonstrated path. [PG_PARTIAL] [PG_LOCK]

#### Idempotency and outbox algorithm

`INSERT ... ON CONFLICT DO NOTHING RETURNING` creates a unique principal/operation/key record. On conflict, read/lock the existing record, compare its typed request digest, and return the original operation or a 409. Do not catch a unique violation and continue issuing statements in the same aborted transaction. Insert the logical payment/intent and outbox event before committing. [PG_CLIENT] [PG_ISOLATION] [PG_CONSTRAINT]

A worker claims due rows with `FOR UPDATE SKIP LOCKED`, increments a fencing version and writes a lease deadline, then commits. The external operation happens outside the SQL transaction. Completion updates require the same lease owner/version. A lease expiring after a crash permits another worker to retry the same operation identity, not create a new payment. The transaction journal and consumed-invoice state make that retry safe. [PG_LOCK] [PG_CLIENT] [BULL_IDEMP]

### 3.3 Smart contracts

#### Chain and build configuration

The primary reproducible demonstration runs on `Anvil` with a distinct local chain ID, an explicitly selected `cancun` hardfork, seeded ETH accounts, `mUSDC` with six decimals and `mRWA` with eighteen decimals. These are mock assets representing the payment flow, not issuer-backed Robinhood shares or genuine Circle USDC. Deploy actual inspected protocol contracts and your own pool/liquidity rather than assuming a faucet or existing market will supply them. [FOUNDRY_ANVIL] [EIP1153] [EIP20]

Pin the v4 source to the inspected `d153b048` revision and resolve/save its full commit ID when fetching it. The inspected `PoolManager` and build config require `0.8.26`/Cancun. For optional Aqua, use a separate build with SwapVM `v1.0.2`; its package manifest pins Aqua `0.1.0`, solidity-utils `6.9.7`, OpenZeppelin `5.4.0`, and forge-std `v1.11.0`. Preserve that dependency graph instead of substituting moving main branches or assuming an audit revision is interchangeable. The Aqua audit-final commit was retrieved separately as comparative evidence, not silently substituted into that graph. [V4_MANAGER_PIN] [V4_BUILD_PIN] [SWAPVM_PACKAGE] [AQUA_AUDIT_PIN]

The live address-page freshness check resolved an actual stale-index conflict: a cached page said vanity addresses were pending and no v1.0.2 tag existed; fresh Firecrawl content says the vanity deployment is live and names the v1.0.2 tag. Its testnet note still distinguishes a live Sepolia registry from a router not yet verified there as of its stated July review. Neither that page nor Robinhood's token table proves today's chosen testnet path. Treat public addresses as candidates requiring `eth_getCode`, binding/domain reads, token balances/allowances and a real payment rehearsal. [AQUA_ADDR] [AQUA_SDK] [RH_TOKENS] [RPC_DOC]

#### Policy and signed types

The source file `CONTRACT_INTERFACE.sol` gives the complete proposed P0 interface/types. The core data model is:

```text
PolicyConfig
  agent
  inputToken, settlementToken
  adapter, routeId
  totalOutputBudget, epochOutputBudget
  automaticOutputCap, escalationOutputCap
  totalInputBudget, maxInputPerPayment
  validAfter, validUntil
  allowedCategoryBitmap
  subsidyMode

MerchantPermission (owner-configured snapshot)
  merchantId, recipient, invoiceSigner, category

Invoice (merchant EIP-712 signature)
  invoiceId, merchantId, recipient, settlementToken
  outputAmount, category, validUntil

PaymentIntent (agent EIP-712 signature)
  policyId, invoiceHash, routeId
  maxInputAmount, nonce, validUntil
  subsidyMode, maxSubsidyAmount

ExceptionApproval (owner EIP-712 signature)
  intentHash, nonce, validUntil
```

These are deliberately smaller than the original manifest-plus-proof protocol. Each policy fixes **one input asset and one route**. The agent may choose among the authorized merchant snapshots and accept invoices of different amounts within the limits. A direct-transfer reference policy has input token equal to settlement token and adapter zero; a v4 policy fixes the RWA input and the selected adapter/pool. Changing those choices requires an owner-created new policy, not agent-supplied arbitrary adapter data.

Use one EIP-712 domain with `name = PayGuard`, `version = 1`, the current chain ID and this vault as verifying contract, with distinct primary types `Invoice`, `PaymentIntent` and `ExceptionApproval`. Their different type hashes separate the message purposes without requiring three different EIP712 base-contract instances. Expose on-chain hash helper functions and use them as cross-language vectors. The invoice hash is the complete invoice typed digest; the intent binds that hash. The owner approval binds the complete intent digest, not a mutable API ID. For P0, derive its nonce as `uint256(intentHash)` and its expiry from the existing intent expiry: generating approval typed data is a read, not a hidden nonce-reservation write. Distinct intents have distinct approval identities under the same hash-collision assumption already required by the signature scheme; on-chain use/cancellation remains explicit. [EIP712] [OZ_SIG] [SOL_ABI]

For owner configuration, the wallet directly calls `createPolicy(config, merchants)`. `msg.sender` must be the immutable owner. Bound merchants to an explicit small maximum, chosen as 32 for the demo; category IDs must fit the bitmap. That limit is an application choice, not a protocol constraint. The policy ID is derived from a root-independent sequence and vault/chain domain, and is never recomputed from mutable configuration. Policies are immutable once created; replacement marks a previous active policy inactive. [SOL_SECURITY] [EIP712]

#### State and replay identities

```text
owner (immutable)
policySequence
policies[policyId]
activePolicyForAgent[agent]
merchantPermissions[policyId][merchantId]
outputSpent[policyId]
epochOutputSpent[policyId][epoch]
inputSpent[policyId]
consumedInvoice[keccak256(abi.encode(recipient, invoiceId))]
usedAgentNonce[agent][nonce]
usedOrCancelledApprovalNonce[nonce]
revokedAgent[agent]
executionPaused
activeExecutionContext
```

`consumedInvoice` is vault-scoped and independent of policy version and signed intent nonce. Changing a quote or issuing a new intent for the same recipient/invoice ID cannot pay again. Agent nonces prevent exact-intent replay, while invoice consumption prevents the same business payment through a new nonce. A dishonest merchant issuing genuinely new invoice IDs remains bounded by owner budgets; the system does not magically infer duplicate real-world goods. [EIP712] [EIP20]

#### Function-level design

| Function | Caller/behavior |
|---|---|
| `deposit(token, amount)` | Supported token only; transferFrom caller, require actual received amount for plain-token model; emit deposit evidence |
| `withdraw(token, amount, recipient)` | Owner only, guarded; execution pause does not disable it; forbid zero recipient |
| `createPolicy(config, merchants)` | Owner only; validate amounts/time/category/route/input token, store immutable config and snapshots, activate for agent |
| `revokePolicy(policyId)` | Owner only; future canonical execution rejects it |
| `revokeAgent(agent)` | Owner only; terminal revocation for this address in P0; use a new address for replacement |
| `setExecutionPaused(bool)` | Owner only; affects payment execution, not withdrawal/revocation |
| `cancelApprovalNonce(nonce)` | Owner only; prevents later use of that exception signature |
| `hashInvoice`, `hashIntent`, `hashApproval` | View helpers returning exact EIP-712 digests |
| `evaluate(invoice,intent,agentSig,merchantSig,approval,ownerSig)` | View-only common validation; returns decision/reason, counters and whether the supplied signature set was checked |
| `executePayment(...)` | Any transaction sender may relay; agent/merchant/owner signatures determine authority; atomic settlement and replay consumption |
| `owner`, `isSupportedToken`, `getPolicy`, `getPolicyState`, `getMerchantPermission` | Read owner, supported assets, configuration, validity and spending counters at an observed block |
| `isInvoiceConsumed`, `isAgentNonceUsed`, `isApprovalNonceUsedOrCancelled` | Explicit replay-state reads for simulation, reconciliation and retry decisions |
| `getExecutionContext` | Read authenticated context, meaningful only during authorized synchronous execution |

Do not make the future frontend call a nonexistent `PoolManager.quoteExactOutput`. P0 obtains full execution estimates through `eth_call` of the actual signed payment, with required approval present. Optional Aqua quoting uses that router's actual `quote` ABI and is followed by full vault simulation. [V4_INTERFACE] [VIEM_SIM] [SWAPVM_CODE]

#### Exact decision rules and escalation matrix

Apply deterministic checks: domain/schema/signatures; active agent/policy and time; authorized merchant/signer/recipient/category; fixed tokens/route; invoice/nonce reuse; hard output/input budgets; then automatic cap/approval. No token moves during evaluation.

| Constraint | Can exact owner exception bypass it? |
|---|---|
| Automatic per-payment output cap | Yes, only if amount is at or below escalationOutputCap |
| Escalation ceiling | No |
| Lifetime or epoch output budget | No |
| Lifetime input budget / maximum input per payment | No |
| Wrong merchant, recipient, category, input/output asset or route | No |
| Expired/revoked/inactive policy or expired invoice/intent | No |
| Consumed invoice / nonce | No |
| Missing required subsidy or price bound | No |

`epoch = floor(block.timestamp / 86400)` is the chosen fixed UTC-epoch convention. Budget counters use settlement output units only; inputSpent uses input-token units only. Approval reserves nothing across transactions. If capacity changes after approval, execution rejects without consuming invoice, counters or approval nonce. [SOL_GLOBALS] [EIP140] [EIP712]

#### Atomic execution algorithm

1. Enter one vault-wide reentrancy guard; validate the complete signed inputs with the same rules as evaluate. For P0 require the bound agent to be an EOA signature or explicitly supported signer type; owner signatures use SignatureChecker, including deployed ERC-1271 owners when tested.
2. Require `outputAmount > 0`, `maxInputAmount <= maxInputPerPayment`, and enough remaining input budget for that ceiling. Require sufficient hard output budgets for the exact invoice amount.
3. Compute invoice-consumption key; mark invoice and agent nonce used, mark any approval nonce used, increment lifetime/epoch output counters, and temporarily reserve maxInputAmount in inputSpent. This reservation exists only inside the current transaction, not while waiting for approval.
4. Save typed activeExecutionContext and snapshot vault input/output balances. A hook must validate this authenticated context, not re-run a predicate that now sees a consumed invoice and altered counters.
5. Direct route: require input equals output token and outputAmount <= maxInputAmount, then transfer exactly outputAmount to the merchant. Conversion route: forceApprove the pinned adapter for maxInputAmount, call typed `settle`, then clear the residual standard allowance.
6. Conversion route: require observed input decrease I to satisfy `0 < I <= maxInputAmount`; require the vault's settlement-token increase to equal outputAmount. Transfer exactly that output to the committed merchant and verify its received delta. For the direct route, I equals outputAmount. Reject aliased vault/adapter/subsidy-fund recipients in this supported-token demo.
7. Refund the in-transaction input reservation by subtracting `maxInputAmount - I`; the final inputSpent increase is actual input I. Clear execution context and emit PaymentExecuted containing intent/invoice/policy/route identities and measured amounts.
8. Any failed signature, transfer, adapter call, fee funding or postcondition reverts the outer call. Do not catch an adapter failure and then return success with consumed counters. Transaction gas is still paid by the sender.

This specifies the ledger omission away rather than hiding it: each vault has one owner, so no user-share ledger exists. Actual token balances and policy spending counters remain distinct. A version retaining shared custody would instead need to reserve/debit/refund the owner's share ledger as well. [SOL_SECURITY] [OZ_GUARD] [OZ_SAFE] [EIP140] [EIP20]

#### v4 exact-output adapter

The adapter has immutable PoolManager, input/output tokens and one allowed PoolKey. No arbitrary targets/selectors or router calldata come from the agent. It uses ordinary external calls, never delegatecall. It pulls at most the approved maxInput from the calling vault, holds that caller in its guarded in-flight context, calls PoolManager.unlock, and authenticates `unlockCallback` by `msg.sender == PoolManager`. [V4_MANAGER] [V4_INTERFACE] [SOL_SECURITY]

Inside the callback, sort currencies by address and derive zeroForOne from the actual input token. `SwapParams.amountSpecified` is **positive for exact output**. Decode the returned BalanceDelta by currency, assert that output credit equals the requested output, and input debt is within the ceiling. A favorable quote or request parameter is not a substitute for inspecting actual deltas. [V4_INTERFACE] [V4_MANAGER]

Pay input by `sync(inputCurrency)`, transfer exactly the debt into PoolManager, and `settle()` from the adapter. Withdraw output using `take(outputCurrency, vault, outputAmount)`. Refund unused prefunded input to the same vault before settle returns. PoolManager must finish with every caller's currency delta zero. Use the same adapter as the caller for all these operations unless an explicit `settleFor` is required. [V4_MANAGER] [V4_INTERFACE]

The adapter may be callable by other vaults, provided it can pull only from its current caller, can return assets only to that caller/committed settlement flow, and cannot touch another execution's funds or residual protocol allowance. It does not need a constructor reference to a not-yet-deployed vault. The vault, however, pins this adapter and route. A hook variant uses a deployer-only, one-time adapter binding to avoid a circular constructor-address dependency; freeze that binding before pool initialization. The subsidy fund also needs an immutable or one-time frozen list of eligible payer vaults for the controlled demo: arbitrary callers must not be able to fabricate a vault execution-context response to draw another merchant's subsidy. This explicit demo enrollment is a proposed trust rule, not a claim that an arbitrary contract can be authenticated by asking it for its own context.

#### Merchant-funded LP subsidy: exact accounting, not a slogan

Build the normal-fee swap first. Add the optional subsidy branch only after its balance equations pass. The proposed branch uses a dynamic-fee pool and a merchant-owned prefunded mUSDC balance. For invoice output O and configured 30 basis points, define:

```text
S = ceil(O * 30 / 10000) = (O * 30 + 9999) / 10000
```

O is bounded by the route's signed range, so this chosen arithmetic does not approach uint256 overflow. The rate is a merchant subsidy on invoice value, **not a claim to reproduce the exact input-token fee a different swap would have charged**. For O = 500000 mUSDC atoms (0.50), S = 1500 atoms (0.0015). This example is arithmetic, not a live quote.

The merchant funds `MerchantSubsidyVault`; only the pinned payment adapter can draw the formula-bounded S for a verified active payment context. The merchant can withdraw its remaining funds. On a supported payment, the adapter draws S before entering the swap callback, and the hook returns an explicit zero LP-fee override. After the swap, the adapter donates S in the correct output-token currency position, transfers those actual funds to PoolManager and settles that donation debt in the same unlock session. The subsidy cannot be counted twice or left as an unpaid PoolManager delta. [V4_FEE] [V4_INTERFACE] [V4_MANAGER]

```text
Payer vault:              RWA -I; mUSDC net 0 after forwarding O
Merchant recipient:      mUSDC +O
Merchant subsidy vault:  mUSDC -S
PoolManager:             RWA +I; mUSDC -O +S
Adapter/hook:            no payment-related leftover balance or delta
LP accounting:           donation contributes to in-range fee growth
Relayer:                 ETH pays transaction gas separately
```

Donation distribution and later LP collection have protocol rounding; do not assert each LP's immediate wallet balance increases by S. Assert the actual donation, matching pool funding, relevant fee-growth/collection result and permitted rounding. A donation with no in-range liquidity fails, so seed a position that remains in range for the demonstrated payments. For the zero-LP-fee claim, also verify protocol-fee state; setting the LP fee to zero does not disable a separately configured protocol fee. [V4_POOL] [V4_MANAGER] [EIP1559]

On subsidy depletion, REQUIRED reverts. BEST_EFFORT selects the explicitly configured normal fee (3000 fee units for 0.30%) and still obeys maxInput. A dynamic pool initially has zero LP fee, so returning plain zero does not implement the intended fee fallback. The hook must explicitly select normal fee or have an independently verified configured baseline. The subsidy mode is present in actual policy and intent types, not only prose. [V4_FEE] [V4_HOOK_INTERFACE]

This remains an **unexecuted composition specification**. The retrieved primitives support it; an actual callback-level end-to-end test is a release gate, not something this report claims completed.

#### Aqua/SwapVM alternative adapter

Place the payer vault/adapter on the **taker** side. Seed a separate maker with mUSDC liquidity and a matching shipped strategy. The maker approves the Aqua registry; the adapter's finite input-token approval targets the SwapVM router for the chosen taker transfer mode. Preserve the actual `(maker, app, strategyHash, token)` keys. A maker's persistent LP allowance does not become a payer-vault unlimited approval. [AQUA_CODE] [SWAPVM_CODE] [AQUA_SDK]

The adapter pins the router, encoded order/program, token pair and permitted maker. It builds the v1.0.2 five-argument `swap(order, tokenIn, tokenOut, amount, takerTraitsAndData)` call. Select exact-output mode, set threshold to maximum input, and set the taker output receiver to the vault. Then the outer vault forwards O to the merchant. Clear finite residual allowances. Do not try to use the Aqua maker's custom receiver as the merchant; that restriction and the taker's output receiver are different paths. [SWAPVM_CODE] [AQUA_SDK]

The Aqua SDK registers strategies; the SwapVM SDK builds program/order/traits calldata. Their `quote`/`swap` helpers produce CallInfo for a client to execute, not a settled transaction merely by constructing an object. A registered strategy's bytes/hash cannot be changed for each invoice without handling re-registration; PayGuard's changing invoice lives in its own signed intent, not the LP strategy hash. [AQUA_SDK] [AQUA_CODE]

Do not append `0xF4` to a stock program and expect it to work. The inspected router uses a registered instruction table; the custom opcode requires a matching forked dispatcher and encoder. If a custom opcode itself runs v4, stock SwapVM settlement still runs afterwards unless deliberately integrated. Such a **combined same-transaction Aqua-plus-v4 path is not included in the verified minimum architecture**. It needs a separately specified maker/taker/callback/receiver conservation proof and executable test. [SWAPVM_OPS] [SWAPVM_CODE] [AQUA_ROUTING]

#### Optional corrected Spend Lockfile mode

Do not build this before the policy-based demo unless exact scheduled purchases are the intended product. If retained, compute a root-independent scope:

```text
scopeId = keccak256(abi.encode(SCOPE_TYPEHASH, chainId, vault, owner, agent, ownerNonce))
innerLeaf = keccak256(abi.encode(SLOT_TYPEHASH, scopeId, completeSlotFields...))
standardLeaf = keccak256(bytes.concat(innerLeaf))
slotsRoot = sorted-pair Merkle tree root of standardLeaf values
manifestDigest = EIP712(headerContaining(scopeId, slotsRoot, budgets, validity, metadataHash))
```

The JavaScript StandardMerkleTree input must produce exactly the same ABI tuple/type list and double hash. Alternatively use a specifically matched custom single-hash tree, but do not mix conventions. Add required subsidy fields, fixed output-token equality, route-policy rather than expiring quote binding where needed, and the same invoice replay key. Optional task ordering/exclusivity requires actual state, not merely objectiveId. A mandatory readable artifact hash helps bind review material but does not prove the wallet displayed it honestly. [MERKLE_DOC] [MERKLE_CODE] [EIP712]

### 3.4 Backend, DB and chain integration

#### Transaction journal and nonce allocation

A relayer is a dedicated EOA used only by this service. Serialize its nonce allocation with one signer row/worker. Fetch nonce context from the configured chain, reserve the nonce in SQL, build and sign the outer transaction, and persist raw transaction bytes plus hash, destination, value, calldata digest and nonce before any send. Only then issue `eth_sendRawTransaction`. If the network times out, keep the nonce family unresolved and reconcile the known hash; optionally re-broadcast identical raw bytes. [EIP1559] [RPC_DOC] [PG_LOCK]

Fee replacements are distinct hashes in the same nonce family with unchanged execution calldata/value/recipient. An independently cancelled transaction can win the nonce without consuming the invoice. A revert consumes network gas/nonce but not PayGuard invoice authority, allowing a deliberate new attempt after its cause is fixed. The worker must never sign a second business payment merely because one HTTP response was lost. [VIEM_RECEIPT] [VIEM_RECEIPT_CODE] [EIP140]

Do not assume a standard `getTransactionBySenderAndNonce` recovery method exists. Recent-block/mempool scans are best effort and provider-specific. The persisted raw transaction identity is the recovery primitive. [RPC_DOC] [RPC_CODE]

#### State model consumed by the frontend

```text
policyDecision:  ALLOW | ESCALATE | BLOCK | UNKNOWN
executionStatus: DRAFT | AWAITING_APPROVAL | READY | QUEUED |
                 SIGNED | SUBMITTED | UNKNOWN | INCLUDED |
                 SUCCEEDED | REVERTED | CANCELLED | REORGED
confidence:      UNOBSERVED | INCLUDED | DEPTH_CONFIRMED |
                 RPC_FINALIZED | LOCAL_DEMO
reconciliation:  NOT_CHECKED | MATCHED | MISMATCH
```

These axes prevent a non-reverting recording transaction, a cancelled transaction or an arbitrary confirmation threshold from being displayed as payment finality. `SUCCEEDED` means the expected PayGuard event and successful receipt were observed in a currently canonical block. It may coexist with INCLUDED confidence while consensus finality is pending. `LOCAL_DEMO` explicitly means local test execution, not Ethereum finality. [RPC_CODE] [ETH_FINALITY]

#### Event handling and recovery

Poll `eth_getLogs` for exact deployed vault/adapter/token addresses and relevant topics in bounded block ranges. Store block number, hash and parent hash alongside logs and receipts. Apply event projections plus cursor advancement in a single DB transaction, idempotently keyed on deployment/block hash/log index. Recheck the most recent canonical cursor hash on each iteration; on mismatch, find the common ancestor, mark old observations orphaned and rebuild affected projections. For the small demo, rebuilding from its deployment block is a practical alternative to a general-purpose event-sourcing engine. [RPC_DOC] [RPC_CODE] [PG_CLIENT]

On reconnect, backfill missed ranges. A websocket may later reduce latency but is not the only history source. A remote provider's range limits are not specified by Ethereum; shrink requests on observed range/timeout errors and keep the cursor unchanged until a complete range is stored. A local chain reset starts a new deployment instance and clears/archive-separates the corresponding application projection, rather than reusing old successful payments. [RH_CONNECT] [FOUNDRY_ANVIL] [PG_CONSTRAINT]

| Failure | Required recovery |
|---|---|
| API crashes before SQL commit | No logical command exists; retry same idempotency key |
| API commits then response is lost | Return existing operation/resource |
| Worker signs then crashes before broadcast | Read stored raw bytes; send the same transaction |
| RPC accepts then times out | UNKNOWN; reconcile/rebroadcast same hash |
| Approval arrives after budget was spent | Reject current execution without consuming approval/invoice |
| Pool movement or missing liquidity causes revert | Same logical invoice remains unpaid; new attempt only after resolving original receipt |
| Merchant subsidy depleted | Required mode reverts; best-effort normal-fee fallback only within signed bounds |
| Indexer stops or receives duplicates | Backfill from stored cursor and deduplicate observations |
| Included block becomes orphaned | Reorg status and replay; never silently claim payment remained final |
| Wrong deployment/ABI or absent code | Fail readiness and refuse transaction preparation |

#### Reconciliation contract

For each observed success, verify the emitting vault, policy ID, invoice key, intent hash, fixed input/output assets, exact output, bounded input, consumed invoice state and canonical successful receipt. Compare event amounts with the restricted token transfer evidence; arbitrary end-of-block balance differences are not unique transaction attribution. For subsidy runs, also verify the actual subsidy transfer/donation and final adapter deltas. A mismatch disables further automatic execution for that payment and remains visible; it never triggers an automatic second payment. [EIP20] [RPC_CODE] [V4_MANAGER]

### 3.5 Frontend-integration contract

No UI implementation is assumed. The frontend receives JSON, typed signing payloads, unsigned transaction requests and read models. It must not reconstruct authorization from display labels or select arbitrary contract addresses.

#### Human and agent authentication

`POST /v1/auth/challenges` accepts `{address, chainId, sessionKind}` and returns `{challengeId, message, expiresAt}`. The server supplies the expected SIWE domain/URI/nonce/time fields. `POST /v1/auth/verify` accepts `{challengeId, signature}`; the server loads the original message rather than accepting a client replacement, validates its chain/URI/time/nonce/domain and signature, atomically consumes the challenge, and creates an HttpOnly/Secure/SameSite session. State-changing browser calls additionally provide an origin-checked CSRF token. [EIP4361] [VIEM_SIWE_CODE] [SESSION] [CSRF]

Persist the SIWE chain ID on the session and require it to match each accessed deployment. The same contract-wallet address on a different chain is not automatically the same authentication authority. Browser chain changes require a new chain-scoped session. [EIP4361] [VIEM_SIWE_CODE]

An agent may use its own challenge-established bearer session for API access, but every fund-moving intent still has the agent's EIP-712 signature checked in the vault. A stolen API session can submit proposals or signatures it possesses; it cannot create a new owner authorization. Revoke API sessions and on-chain agents through distinct actions and display their separate completion states. [EIP712] [EIP4361] [EIP2771]

Wallet network/account changes invalidate prepared owner transactions and require rechecking the session/selected vault. The browser wallet provider, not the backend, is where actual ERC-7715 capability queries must execute. Native P0 does not require those optional calls. [EIP1193] [EIP7715]

#### Funding and owner controls

`GET /v1/vaults` and `GET /v1/vaults/{id}` return owner-scoped vaults, supported-token balances, active policies and block observations. `POST /v1/vaults/{id}/transactions` prepares only a discriminated owner action: deposit, withdraw, revoke agent, pause/unpause execution, or cancel approval nonce. It never accepts an arbitrary target, selector or calldata. For a deposit, return a finite ERC-20 approval transaction when required, followed by the vault deposit transaction; the client waits for each successful receipt and rechecks state before submitting the next. These are separate transactions, not a cross-transaction atomic deposit promise. The owner signs and pays for those configuration/funding calls. [EIP20] [OZ_SAFE] [EIP1559]

Balances and counter responses use the explicit read functions in the companion contract interface. A signature cached in the database does not authorize withdrawal. Owner configuration transactions are tracked in owner-scoped `operations` records by their observed hash/receipt separately from the agent-payment nonce journal; the backend does not reconstruct a raw wallet transaction it never received. [EIP1193] [RPC_CODE]

#### Endpoint inventory and exact response responsibilities

The fuller request/response specification is in `API_CONTRACT.md`. All chain IDs, counters and amounts are decimal strings; block hashes/addresses are hex strings. IDs in examples are illustrative, not deployed addresses or valid signatures.

| Method and path | Request | Response / authority |
|---|---|---|
| GET `/v1/operations/{id}` | authorized owner/agent session | queued/result/unknown operation state with original resource identity |
| GET `/v1/config` | none | deploymentId, chainId, vault/adapter routes, ABI/schema versions, token addresses/decimals, confidence policy; no secrets |
| POST `/v1/auth/challenges` | address, chainId, sessionKind | stored SIWE challenge/message |
| POST `/v1/auth/verify` | challengeId, signature | session identity and CSRF token; cookie set |
| POST `/v1/auth/logout` | session | session revoked only |
| POST `/v1/policy-drafts` | vaultId, PolicyConfig, merchants | draftId, version, normalized review payload |
| PUT `/v1/policy-drafts/{id}` | expectedVersion, changed draft | new version or 409 |
| POST `/v1/policy-drafts/{id}/transaction` | expectedVersion | exact owner transaction {chainId,from,to,data,value}, review fields, payload hash |
| POST `/v1/chain-observations` | deploymentId, txHash, relatedResourceId | tracking operation; client-supplied hash is a hint, not proof |
| GET `/v1/policies/{id}` | owner session | authoritative on-chain ID/config plus observed block/counters |
| POST `/v1/policies/{id}/revocation-transaction` | owner session | prepared owner transaction, no state change yet |
| POST `/v1/invoices` | Invoice, merchantSignature, vaultId | digest, validation result, stable invoice resource |
| POST `/v1/payment-intents` | invoiceId, policyId, PaymentIntent, agentSignature | logical payment ID, intent version, initial evaluation; idempotency required |
| POST `/v1/payment-intents/{id}/simulate` | no mutable business data | exact execution simulation/block/hash/result, or approval-required result |
| GET `/v1/payment-intents/{id}/approval-typed-data` | owner session | exact owner EIP-712 approval fields and independent decoded summary |
| POST `/v1/payment-intents/{id}/approvals` | approval, ownerSignature | signature record; not a false claim that a chain approval transaction exists |
| POST `/v1/payment-intents/{id}/submit` | fixed intent ID; idempotency key | queued durable operation; no changed route/recipient/amount accepted |
| GET `/v1/payments/{id}` | authorized owner/agent/merchant view | decision, execution, confidence, measured result, attempt history |
| GET `/v1/payments/{id}/timeline` | cursor, limit | ordered stable events with block/canonicality |
| GET `/v1/payments` | cursor/status filters | owner-scoped keyset page, nextCursor |
| GET `/v1/transactions/{hash}` | deploymentId | tx family, receipt/canonical state, replacement |
| GET `/health/live`, `/health/ready` | operator/public minimal | process liveness; DB/RPC/deployment/worker readiness |

Resource ownership is checked on every read and mutation, not only login. A merchant view exposes its own invoice/payment outcome, not another owner's full policy or signed artifacts. There is no `PATCH status`, arbitrary relayer-calldata endpoint or browser-controlled adapter address. [FASTIFY_SCHEMA] [SESSION] [PG_CONSTRAINT]

A payment detail looks like this, with fake IDs shown only to define the shape:

```json
{
  "data": {
    "paymentId": "payment-example",
    "intentId": "intent-example",
    "deploymentId": "deployment-example",
    "chainId": "31337",
    "policyDecision": "ALLOW",
    "executionStatus": "SUCCEEDED",
    "confidence": "LOCAL_DEMO",
    "reconciliation": "MATCHED",
    "settlement": {
      "outputAmountAtomic": "500000",
      "actualInputAtomic": "2501000000000000",
      "subsidyAmountAtomic": "1500"
    },
    "transaction": { "hash": "<actual-32-byte-hash>", "replacementOf": null },
    "observedAt": { "blockNumber": "42", "blockHash": "<actual-32-byte-hash>" }
  },
  "requestId": "req-example"
}
```

The sample input amount is illustrative, not a predicted v4 quote. Populate measured amounts only after chain execution. Before that, return `null` for actual input and a separately named signed maximum. A successful POST or returned tx hash must never populate `actualInputAtomic` as if settlement already occurred.

### 3.6 Build sequencing and concrete acceptance gates

| Order | Build/prove | Done when |
|---|---|---|
| 0 | Retrieve exact dependency versions, compile source graphs separately, deploy local protocol fixture, test wallet signing and ABI selectors | Bytecode exists at recorded addresses; correct chain/pragma/hardfork; a bare protocol swap works without PayGuard |
| 1 | Per-owner vault, owner policy, merchant/agent signatures, invoice/nonce consumption, direct transfer, exception matrix | Valid direct payment settles; mutation/replay/revoke/expiry/over-budget revert; 180-unit approval bypasses only the automatic cap |
| 2 | PostgreSQL schema, idempotent API, signed-artifact storage, one worker/relayer journal, receipt-backed queries | Full HTTP -> DB -> signed transaction -> receipt -> GET path works and survives accept-then-timeout/restart |
| 3 | v4 adapter attached to the same authorization core | Real local RWA-to-settlement-token swap delivers exact output; all deltas settle; input/allowance limits hold |
| 4 | Merchant-subsidy hook/fund, if included in the demo promise | Donation funded; zero LP override correct; normal-fee fallback explicit; payer/merchant/pool/fund balances reconcile |
| 5 | Optional Aqua alternative adapter | Matching maker strategy, taker mode, router ABI and receiver work; no extra payer approval survives |
| 6 | Frontend integration rehearsal through a command-line client using the public API | Owner and agent auth, policy configuration, allow/block/escalate, polling and error states require no private backend knowledge |
| 7 | Deployment rehearsal and deterministic reset | New deployment instance; no stale success rows; ETH/assets/liquidity/subsidy seeded; only observed receipts shown |

Keep one complete end-to-end payment path working at each gate. This is an implementation order, not a timeline estimate. Direct transfer is a reference fallback, not evidence that RWA conversion or both sponsor integrations worked.

The original demo needs small content corrections before acceptance: include Compute in the owner-approved category set, use one consistent input token/pool, configure an escalation ceiling above 180, and display the actual first failed hard rule for 500 rather than a prewritten cap error. Never hardcode `0.0021 NVDA` or a zero stranded balance as the result of an unexecuted swap. Product source: PayGuard v0.3 lines 227-234.


<!-- Retrieved source links -->
[AQUA_ADDR]: https://business.1inch.com/portal/documentation/aqua/reference/verified-contract-addresses "Fresh verified-address reference"
[AQUA_AUDIT_PIN]: https://github.com/1inch/aqua/blob/af53fc31b636c683a6b72cf4755f5aad089c12e8/src/Aqua.sol "Aqua at audit-final revision"
[AQUA_CODE]: https://github.com/1inch/aqua/blob/main/src/Aqua.sol "Aqua registry implementation"
[AQUA_ROUTING]: https://business.1inch.com/portal/documentation/aqua/liquidity-layer/access-resolvers-and-pathfinder "Aqua access, resolvers and Pathfinder"
[AQUA_SDK]: https://business.1inch.com/portal/documentation/aqua/reference/sdk-overview "Aqua and SwapVM SDK overview"
[BULL_IDEMP]: https://docs.bullmq.io/patterns/idempotent-jobs "BullMQ idempotent jobs"
[CSRF]: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html "OWASP CSRF prevention"
[EIP1153]: https://eips.ethereum.org/EIPS/eip-1153 "Transient storage"
[EIP1193]: https://eips.ethereum.org/EIPS/eip-1193 "Wallet provider API"
[EIP1271]: https://eips.ethereum.org/EIPS/eip-1271 "ERC-1271 contract signatures"
[EIP140]: https://eips.ethereum.org/EIPS/eip-140 "EIP-140 REVERT"
[EIP1559]: https://eips.ethereum.org/EIPS/eip-1559 "Transaction fee mechanics"
[EIP20]: https://eips.ethereum.org/EIPS/eip-20 "ERC-20"
[EIP2771]: https://eips.ethereum.org/EIPS/eip-2771 "Native meta-transactions"
[EIP4361]: https://eips.ethereum.org/EIPS/eip-4361 "Sign-In with Ethereum"
[EIP712]: https://eips.ethereum.org/EIPS/eip-712 "EIP-712 typed structured data"
[EIP7715]: https://eips.ethereum.org/EIPS/eip-7715 "Request execution permissions"
[ENS_CODE]: https://github.com/ensdomains/ens-contracts/blob/master/contracts/resolvers/profiles/TextResolver.sol "ENS TextResolver source"
[ETH_FINALITY]: https://ethereum.org/en/developers/docs/consensus-mechanisms/pos/ "Ethereum proof-of-stake finality"
[FASTIFY_CODE]: https://github.com/fastify/fastify/blob/v5.12.1/package.json "Fastify v5.12.1 package/source"
[FASTIFY_PACKAGE]: https://registry.npmjs.org/fastify/5.12.1 "Published Fastify 5.12.1"
[FASTIFY_SCHEMA]: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/ "Fastify validation/serialization"
[FOUNDRY_ANVIL]: https://getfoundry.sh/anvil/reference/ "Anvil reference"
[FOUNDRY_RELEASE]: https://github.com/foundry-rs/foundry/releases "Foundry stable release listing"
[JCS]: https://www.rfc-editor.org/rfc/rfc8785 "RFC 8785 JSON canonicalization"
[MERKLE_CODE]: https://github.com/OpenZeppelin/merkle-tree/blob/master/src/hashes.ts "OpenZeppelin Merkle hashing"
[MERKLE_DOC]: https://github.com/OpenZeppelin/merkle-tree "OpenZeppelin Merkle tree library"
[METAMASK_RPC]: https://docs.metamask.io/smart-accounts-kit/reference/advanced-permissions/wallet-client "MetaMask wallet-client actions"
[NODE_RELEASE]: https://nodejs.org/en/about/previous-releases "Node.js release policy/status"
[OZ_GUARD]: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.4.0/contracts/utils/ReentrancyGuard.sol "ReentrancyGuard v5.4.0"
[OZ_SAFE]: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.4.0/contracts/token/ERC20/utils/SafeERC20.sol "SafeERC20 v5.4.0"
[OZ_SIG]: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.4.0/contracts/utils/cryptography/SignatureChecker.sol "OpenZeppelin SignatureChecker v5.4.0"
[PG_CLIENT]: https://node-postgres.com/features/transactions "node-postgres transactions"
[PG_CONSTRAINT]: https://www.postgresql.org/docs/17/ddl-constraints.html "PostgreSQL 17 constraints"
[PG_ISOLATION]: https://www.postgresql.org/docs/17/transaction-iso.html "PostgreSQL 17 transaction isolation"
[PG_JSON]: https://www.postgresql.org/docs/17/datatype-json.html "PostgreSQL 17 JSON types"
[PG_LOCK]: https://www.postgresql.org/docs/17/sql-select.html "PostgreSQL 17 SELECT and locking"
[PG_NUMERIC]: https://www.postgresql.org/docs/17/datatype-numeric.html "PostgreSQL 17 exact numeric"
[PG_PACKAGE]: https://registry.npmjs.org/pg/8.20.0 "Published pg 8.20.0"
[PG_PARTIAL]: https://www.postgresql.org/docs/17/indexes-partial.html "PostgreSQL partial indexes"
[PG_TYPES]: https://node-postgres.com/features/types "node-postgres type parsing"
[RH_CONNECT]: https://docs.robinhood.com/chain/connecting/ "Robinhood network configuration"
[RH_TOKENS]: https://docs.robinhood.com/chain/contracts/ "Robinhood token-contract reference"
[RPC_CODE]: https://github.com/ethereum/execution-apis/blob/main/src/eth/transaction.yaml "Execution API transaction schema"
[RPC_DOC]: https://ethereum.org/en/developers/docs/apis/json-rpc/ "Ethereum JSON-RPC"
[SESSION]: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html "OWASP session management"
[SOL_ABI]: https://docs.soliditylang.org/en/latest/abi-spec.html "Solidity ABI specification"
[SOL_GLOBALS]: https://docs.soliditylang.org/en/latest/units-and-global-variables.html "Solidity global variables"
[SOL_SECURITY]: https://docs.soliditylang.org/en/latest/security-considerations.html "Solidity security considerations"
[SWAPVM_BUILD]: https://github.com/1inch/swap-vm/blob/v1.0.2/foundry.toml "SwapVM v1.0.2 build configuration"
[SWAPVM_CODE]: https://github.com/1inch/swap-vm/blob/v1.0.2/src/SwapVM.sol "SwapVM v1.0.2 implementation"
[SWAPVM_OPS]: https://github.com/1inch/swap-vm/blob/v1.0.2/src/opcodes/AquaOpcodes.sol "AquaOpcodes v1.0.2"
[SWAPVM_PACKAGE]: https://github.com/1inch/swap-vm/blob/v1.0.2/package.json "SwapVM v1.0.2 dependency manifest"
[TS_PACKAGE]: https://registry.npmjs.org/typescript/5.9.3 "Published TypeScript 5.9.3"
[V4_BUILD]: https://github.com/Uniswap/v4-core/blob/main/foundry.toml "Uniswap v4 core build configuration"
[V4_BUILD_PIN]: https://github.com/Uniswap/v4-core/blob/d153b048/foundry.toml "Uniswap build at inspected revision"
[V4_FEE]: https://github.com/Uniswap/v4-core/blob/main/src/libraries/LPFeeLibrary.sol "Uniswap v4 LPFeeLibrary"
[V4_HOOK_INTERFACE]: https://github.com/Uniswap/v4-core/blob/main/src/interfaces/IHooks.sol "Uniswap v4 IHooks"
[V4_INTERFACE]: https://github.com/Uniswap/v4-core/blob/main/src/interfaces/IPoolManager.sol "Uniswap v4 IPoolManager"
[V4_MANAGER]: https://github.com/Uniswap/v4-core/blob/main/src/PoolManager.sol "Uniswap v4 PoolManager source"
[V4_MANAGER_PIN]: https://github.com/Uniswap/v4-core/blob/d153b048/src/PoolManager.sol "Uniswap PoolManager inspected revision"
[V4_POOL]: https://github.com/Uniswap/v4-core/blob/main/src/libraries/Pool.sol "Uniswap v4 pool implementation"
[VIEM_PACKAGE]: https://registry.npmjs.org/viem/latest "Published viem registry metadata"
[VIEM_RECEIPT]: https://viem.sh/docs/actions/public/waitForTransactionReceipt "viem receipt/replacement action"
[VIEM_RECEIPT_CODE]: https://github.com/wevm/viem/blob/main/src/actions/public/waitForTransactionReceipt.ts "viem receipt implementation"
[VIEM_SIM]: https://viem.sh/docs/contract/simulateContract "viem contract simulation"
[VIEM_SIM_CODE]: https://github.com/wevm/viem/blob/viem%402.56.3/src/actions/public/simulateContract.ts "viem 2.56.3 simulation implementation"
[VIEM_SIWE_CODE]: https://github.com/wevm/viem/blob/main/src/actions/siwe/verifySiweMessage.ts "viem SIWE source"
