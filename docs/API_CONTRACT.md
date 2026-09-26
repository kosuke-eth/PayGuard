# PayGuard frontend-integration contract, proposed v1

This is a proposed application API, not a running service or a claim that these endpoints already exist. It accompanies the verified review. Source basis: Fastify schema/lifecycle [FASTIFY_SCHEMA], typed signatures [EIP712], SIWE [EIP4361] [VIEM_SIWE_CODE], SQL transaction boundaries [PG_CLIENT], and wallet provider behavior [EIP1193]. Source URLs are in the review and sources.json.

## Common wire rules

Authenticated business mutations require a valid session; resource-creating/execution commands additionally require `Idempotency-Key`. Login challenge creation and signature verification are session-establishment endpoints, so neither requires a pre-existing session. Browser mutations also require a session-bound `X-CSRF-Token` and an accepted Origin. Agent sessions use Authorization bearer tokens obtained by signing their own login challenge. Resource access is checked against the authenticated wallet on every call. Roles are derived from resource ownership and policy bindings, not an arbitrary user-provided role flag. Sessions retain the verified SIWE chainId; every resource access must match that deployment chain. Switching chain requires a new chain-scoped login, especially for ERC-1271 accounts whose authority may differ across chains. [EIP4361] [VIEM_SIWE_CODE]

`chainId`, token amounts, nonces, budgets, Unix-second expiries and block numbers are canonical unsigned decimal strings. Addresses are 0x-prefixed 20-byte hex; hashes are 0x-prefixed 32-byte hex; signatures and calldata are even-length 0x-prefixed bytes. Reject extra properties, numeric coercion, exponent notation, leading signs and missing required values. ISO-8601 UTC strings are used for database observation timestamps such as createdAt; they are not mixed with on-chain Unix-second fields.

Response envelopes:

```text
Success<T> = { data: T, requestId: string }
Failure = { error: { code: string, message: string, retryable: boolean,
                    requestId: string, details?: object } }
Operation = { operationId: UUID, resourceType: string, resourceId: UUID,
              status: 'QUEUED'|'IN_PROGRESS'|'COMPLETED'|'UNKNOWN'|'FAILED' }
Observation = { blockNumber: UIntString, blockHash: Hash32,
                canonical: boolean, observedAt: ISODate }
UnsignedTransaction = { chainId: UIntString, from: Address, to: Address,
                        data: HexBytes, value: UIntString,
                        calldataHash: Hash32, abiSchemaVersion: '1' }
```

Wallet libraries must translate the HTTP representation into their documented transaction request shape; do not pass a decimal-string chainId into an RPC field expecting hexadecimal quantity. Prepared transaction bytes are authoritative; the future client verifies the chain/from/to and independently displays their decoded values before wallet submission. A changed wallet account/network invalidates the prepared request.

## Canonical business models

```text
PolicyConfig = {
  agent: Address, inputToken: Address, settlementToken: Address,
  adapter: Address, routeId: Hash32,
  totalOutputBudget: UIntString, epochOutputBudget: UIntString,
  automaticOutputCap: UIntString, escalationOutputCap: UIntString,
  totalInputBudget: UIntString, maxInputPerPayment: UIntString,
  validAfter: UIntString, validUntil: UIntString,
  allowedCategoryBitmap: UIntString,
  subsidyMode: 'NONE'|'REQUIRED'|'BEST_EFFORT'
}
MerchantPermission = {
  merchantId: Hash32, recipient: Address, invoiceSigner: Address,
  category: UIntString
}
Invoice = {
  invoiceId: Hash32, merchantId: Hash32, recipient: Address,
  settlementToken: Address, outputAmount: UIntString,
  category: UIntString, validUntil: UIntString
}
PaymentIntent = {
  policyId: Hash32, invoiceHash: Hash32, routeId: Hash32,
  maxInputAmount: UIntString, nonce: UIntString, validUntil: UIntString,
  subsidyMode: 'NONE'|'REQUIRED'|'BEST_EFFORT', maxSubsidyAmount: UIntString
}
ExceptionApproval = { intentHash: Hash32, nonce: UIntString, validUntil: UIntString }
```

The wire category string converts to uint32 after checking it is less than 256. Subsidy modes convert to uint8 values NONE=0, REQUIRED=1, BEST_EFFORT=2. The EIP-712 type for that enum field is uint8, not a string. The Solidity interface defines the exact remaining integer widths. String representations here are transport choices, not new signature field types.

Invoice and intent hashes are returned by the on-chain hash helpers as well as the shared encoder. The invoice signature is by the policy-pinned invoiceSigner. The intent signature is by the policy agent. The approval signature is by the vault owner, and can override only automaticOutputCap. No HTTP login credential substitutes for any of these signatures.

One EIP-712 domain: name 'PayGuard', version '1', correct chainId, verifyingContract equal to the actual vault. Distinct primary types are Invoice, PaymentIntent and ExceptionApproval; the primary type hashes distinguish their purposes. The JSON typed-data response includes domain, types, primaryType, message, expectedSigner and computedDigest. Optional empty approval is encoded as a zero-valued approval struct plus empty signature; the execution validator ignores that pair only for an ALLOW not requiring exception.

## Configuration and authentication

### GET /v1/config

Public response:

```text
{
 deploymentId: UUID, environment: 'LOCAL_DEMO'|'TESTNET', chainId: UIntString,
 schemaVersion: '1', abiSchemaVersion: '1',
 tokens: [{address: Address, symbol: string, decimals: integer, isMock: boolean}],
 routes: [{routeId: Hash32, adapter: Address, kind: 'DIRECT'|'UNISWAP_V4'|'AQUA',
           inputToken: Address, outputToken: Address, subsidyModes: string[]}],
 confidencePolicy: {mode: 'LOCAL_DEMO'|'RPC_FINALIZED'|'DEPTH_CONFIRMED',
                    confirmationDepth: UIntString|null}
}
```

Only configured, tested routes are advertised as enabled. An unverified public Aqua address does not become an enabled route by appearing in documentation. Private RPC URLs/keys and relayer secrets are never returned.

### POST /v1/auth/challenges

Request `{address, chainId, sessionKind:'BROWSER'|'AGENT'}`. The server creates the complete SIWE message including its own domain, URI, nonce, expiry and an appropriate login statement. Response `{challengeId:UUID,message:string,expiresAt:ISODate}`. Browser and agent sessions share identity verification, but differ in credential delivery; callers cannot self-assign resource ownership.

### POST /v1/auth/verify

Request `{challengeId:UUID,signature:HexBytes}`. The server loads and verifies the exact original message, expected nonce/domain/URI/chain/expiry and signature. Challenge consumption and session creation are atomic. Browser response `{walletAddress,sessionExpiresAt,csrfToken}`, with HttpOnly/Secure/SameSite cookie. Agent response `{walletAddress,sessionExpiresAt,accessToken}`; the token authorizes the API session only.

### POST /v1/auth/logout

Request `{}`; returns `{revoked:true}`. It does not revoke an agent on-chain. A separate owner transaction is required for that authority change.

### GET /v1/operations/{id}

Authenticated operation owner or resource-bound agent read. Returns Operation plus `result`, `transactionHash`, and the original resource identity when available. Operations are stored durably in SQL and completed only from the corresponding command result or verified receipt. This endpoint covers owner configuration/funding transactions as well as queued agent submissions; owner-wallet raw transaction bytes are not assumed available to the server.

## Vault discovery, funding and owner controls

### GET /v1/vaults

Owner-session query with keyset cursor/limit. Response `{items:[{vaultId,ownerAddress,address,deploymentId,chainId}],nextCursor}`. Vaults are seeded/deployed by the deployment script for the demonstration; this API does not promise an unimplemented public vault factory.

### GET /v1/vaults/{id}

Owner or bound-agent read: `{vaultId,ownerAddress,address,deploymentId,chainId,executionPaused,balances:[{token,symbol,amountAtomic}],activePolicies:[{policyResourceId,onchainPolicyId,agent}],observation}`. The API reads the explicit contract views and supported token balanceOf calls. A merchant does not receive this owner balance view.

### POST /v1/vaults/{id}/transactions

Owner-only session, CSRF and Idempotency-Key. This endpoint accepts exactly one discriminated union, with all other fields rejected:

```text
{action:'DEPOSIT', token:Address, amountAtomic:UIntString}
{action:'WITHDRAW', token:Address, amountAtomic:UIntString, recipient:Address}
{action:'REVOKE_AGENT', agent:Address}
{action:'SET_EXECUTION_PAUSED', paused:boolean}
{action:'CANCEL_APPROVAL_NONCE', nonce:UIntString}
```

Response `{operationId:UUID,transactions:[UnsignedTransaction],review:object}`. An approval-required deposit may return `approve(vault, amount)` followed by `deposit(token, amount)`; approval amount is finite and spender must be the selected vault. Wait for successful receipt before the next transaction, and prepare again if account/chain/allowance/balance changes. Approval and deposit are not one atomic operation. Only configured plain tokens are accepted. Other actions yield one owner-signed transaction. The backend never signs for the owner and never accepts caller-supplied targets or selectors. Submit resulting hashes through `/v1/chain-observations`. Revocation/pause/cancellation take effect only after their chain transaction executes. [EIP20] [OZ_SAFE] [EIP1559] [RPC_CODE]

Optional subsidy-fund deposit/withdraw endpoints are not included in P0: the deployment/merchant fixture prefunds that optional module. An enabled public merchant-funding API must separately bind the fund contract, merchant owner and token; it must not reuse the payer-vault action endpoint against a different address.

## Policy preparation

### POST /v1/policy-drafts

Owner request `{vaultId:UUID,config:PolicyConfig,merchants:MerchantPermission[]}`. Validate the selected vault owner, fixed route/input/output, hard limits, expiry and at most 32 merchant snapshots. Response `{draftId:UUID,draftVersion:'1',review:...}`. No chain authority is created.

### PUT /v1/policy-drafts/{id}

Owner request `{expectedVersion:UIntString,config,merchants}`. Response updated version and normalized review data; conflict returns `409 DRAFT_VERSION_CONFLICT`. A submitted/compiled revision is immutable evidence; editing creates a new revision rather than changing old transaction bytes.

### POST /v1/policy-drafts/{id}/transaction

Owner request `{expectedVersion:UIntString}`. Response `{transaction:UnsignedTransaction,review:{config,merchants},draftDigest:Hash32}`. This prepares createPolicy, not an owner signature proxy. The wallet signs and broadcasts the owner transaction.

### POST /v1/chain-observations

Authenticated request `{deploymentId:UUID,txHash:Hash32,relatedResourceId:UUID}`. Response `Operation`. The hash is an indexing hint. Verify actual destination, calldata/configuration, receipt and event before activating the related policy. A caller cannot assert success using a made-up transaction hash.

### GET /v1/policies/{id}

Owner or bound-agent response `{policyId:UUID,onchainPolicyId:Hash32,vault:Address,config,merchants,status,counters:{outputSpent,epochOutputSpent,inputSpent},observation:Observation}`. Counter fields are UIntString. Raw chain observation distinguishes stale/offline data from current authority.

### POST /v1/policies/{id}/revocation-transaction

Owner request `{}`. Returns a prepared owner transaction and review summary. Completion is tracked through chain-observations. The same transaction-preparation pattern applies to agent revocation, execution pause and owner withdrawal; adding those actions must preserve owner authorization and exact ABI encoding, not introduce a general arbitrary transaction endpoint.

## Invoices, intents and approvals

### POST /v1/invoices

Request `{vaultId:UUID,invoice:Invoice,merchantSignature:HexBytes}`. Verify typed digest/signature and store exact artifact. Response `{invoiceResourceId:UUID,invoiceHash:Hash32,signatureValid:boolean,invoice:Invoice}`. Policy-specific merchant permission is checked when creating/evaluating the payment. A same vault/recipient/invoiceId with changed invoice bytes returns `409 INVOICE_ID_REUSED`, not a second payable obligation.

### POST /v1/payment-intents

Bound-agent request `{invoiceResourceId:UUID,policyResourceId:UUID,intent:PaymentIntent,agentSignature:HexBytes}` with Idempotency-Key. Check that all resources belong to the same vault/deployment, intent.policyId is the on-chain policy, invoiceHash matches, and the signer is its agent. Return `{paymentId:UUID,intentId:UUID,intentVersion:UIntString,evaluation:Evaluation}`. One invoice maps to one logical payment; concurrent creation uses DB uniqueness and returns the existing operation or conflict, not a second payment.

```text
Evaluation = {
 decision:'ALLOW'|'ESCALATE'|'BLOCK'|'UNKNOWN', reasonCode:string,
 signaturesChecked:boolean,
 remainingOutputAtomic:UIntString|null,
 remainingEpochOutputAtomic:UIntString|null,
 remainingInputAtomic:UIntString|null,
 simulatedAt:Observation|null
}
```

A provider failure returns UNKNOWN rather than a false BLOCK. A BLOCK stores the attempted signed bytes/reason off-chain; no on-chain denial event is claimed.

### POST /v1/payment-intents/{id}/simulate

Request `{}`. Response `{evaluation,executionSimulation:{available:boolean,actualInputEstimateAtomic:UIntString|null,gasEstimate:UIntString|null,calldataHash:Hash32|null,simulatedAt:Observation|null}}`. `available:false` for missing required approval. With signatures present, simulate the exact vault call; a standalone protocol quote is not used as evidence that the full payment can execute. Estimate fields are explicitly estimates, not settlement evidence.

### GET /v1/payment-intents/{id}/approval-typed-data

Owner response `{typedData:{domain,types,primaryType,message},expectedSigner:Address,computedDigest:Hash32,review:{merchant:Address,outputToken:Address,exactOutputAtomic:UIntString,inputToken:Address,maxInputAtomic:UIntString,routeId:Hash32,override:'AUTOMATIC_OUTPUT_CAP_ONLY',validUntil:UIntString}}`. The approval names the exact intent digest. P0 deterministically uses uint256(intentHash) as approval nonce and the intent expiry as validUntil, so this GET does not reserve state; it checks that the nonce is not already used/cancelled. Changing its protected fields requires another approval; refreshing an estimate without changing the intent does not.

### POST /v1/payment-intents/{id}/approvals

Owner request `{approval:ExceptionApproval,ownerSignature:HexBytes}`. Response `{approvalId:UUID,signatureValidAt:Observation,status:'SIGNED'}`. The API does not claim an on-chain approval event exists merely because it stored a signature. ExecutePayment verifies the signature again and consumes the nonce atomically with settlement. If the approval becomes invalid/cancelled or capacity changes, it does not force execution.

### POST /v1/payment-intents/{id}/submit

Owner or bound-agent request `{}`, Idempotency-Key required. Returns `Operation`, paymentId and intentId. The server accepts no changed merchant, amount, route or calldata here. Worker simulation, signing, raw-tx persistence and broadcast use the stored signed intent. Repeating submit returns the same operation. UNKNOWN broadcast state blocks blind creation of another payment.

## Queries and frontend state handling

### GET /v1/payments/{id}

```text
PaymentView = {
 paymentId:UUID,intentId:UUID|null,deploymentId:UUID,chainId:UIntString,
 invoice:{invoiceId:Hash32,recipient:Address,outputToken:Address,outputAmountAtomic:UIntString},
 authorized:{inputToken:Address,maxInputAtomic:UIntString,routeId:Hash32},
 policyDecision:'ALLOW'|'ESCALATE'|'BLOCK'|'UNKNOWN',
 executionStatus:'DRAFT'|'AWAITING_APPROVAL'|'READY'|'QUEUED'|'SIGNED'|
                 'SUBMITTED'|'UNKNOWN'|'INCLUDED'|'SUCCEEDED'|'REVERTED'|'CANCELLED'|'REORGED',
 confidence:'UNOBSERVED'|'INCLUDED'|'DEPTH_CONFIRMED'|'RPC_FINALIZED'|'LOCAL_DEMO',
 reconciliation:'NOT_CHECKED'|'MATCHED'|'MISMATCH',
 reasonCode:string|null,
 settlement:{actualInputAtomic:UIntString,outputDeliveredAtomic:UIntString,
             subsidyAmountAtomic:UIntString}|null,
 transaction:{hash:Hash32,replacementOf:Hash32|null}|null,
 observedAt:Observation|null
}
```

Actual settlement fields are null until a verified successful canonical receipt/event exists. On reorg, mark the prior observation noncanonical and clear/recompute the current settlement projection; retain its historical timeline entry. A successful transaction receipt for a different contract or a recordAttempt call is not a PayGuard payment success.

### GET /v1/payments and GET /v1/payments/{id}/timeline

Query `{cursor?:string,limit?:integer,status?:string}`. Return `{items:[...],nextCursor:string|null}`. The server uses owner-filtered keyset pagination on `(createdAt,id)`; cursors never override authorization. Timeline entries include eventId, type, creation time, tx/block identities where relevant, canonicality and reason. The future UI can render all states without assuming one monolithic finality enum.

### GET /v1/transactions/{hash}?deploymentId=...

Return sender/nonce, state, replacement chain, canonical receipt identity, confidence and associated authorized payment view. Do not expose raw signing secrets or private RPC diagnostics. User-wallet transactions are observed, not automatically repriced by the backend.

### GET /health/live and GET /health/ready

Liveness checks process availability. Readiness checks SQL access, worker freshness, expected chain ID, required code/ABI/deployment configuration, and relayer balance sufficient for configured operations. Unverified/mismatched deployment refuses payment preparation instead of silently selecting a different network.

## Representative error mapping

| Code | Typical HTTP | Meaning/action |
|---|---:|---|
| INVALID_SCHEMA | 400 | Wrong shape/number type/extra field; change request |
| INVALID_SESSION | 401 | Reauthenticate; no on-chain authority change |
| RESOURCE_FORBIDDEN | 403 | Wrong owner/agent/merchant view |
| IDEMPOTENCY_KEY_REUSED | 409 | Same key with different normalized request |
| DRAFT_VERSION_CONFLICT | 409 | Reload draft version |
| INVOICE_ID_REUSED | 409 | Same invoice identity with changed bytes |
| INVOICE_ALREADY_PAID | 409 | Contract consumption, no new payment |
| TOTAL_OUTPUT_BUDGET_EXCEEDED | 422 | Hard cap; approval cannot override |
| INPUT_BUDGET_EXCEEDED | 422 | Hard input-asset cap; approval cannot override |
| APPROVAL_REQUIRED | 422 or evaluation response | Exact owner exception needed |
| INVALID_APPROVAL | 422 | Wrong intent, signer, nonce or expiry |
| ROUTE_MISMATCH | 422 | Policy did not authorize requested route |
| CHAIN_STATE_UNKNOWN | operation status or 503 | Preserve identity and reconcile |
| DEPLOYMENT_MISMATCH | 503 | Operator/deployment correction required |
| SETTLEMENT_REVERTED | payment/tx result | Original invoice remains unpaid; resolve receipt before new attempt |

The distinction between a normal evaluation response and a rejected submit command is deliberate: a readable ESCALATE decision is not an API server failure. Exact contract errors must be mapped from the generated ABI, not brittle substring matching on RPC messages.


<!-- Retrieved source links -->
[EIP1193]: https://eips.ethereum.org/EIPS/eip-1193 "Wallet provider API"
[EIP1559]: https://eips.ethereum.org/EIPS/eip-1559 "Transaction fee mechanics"
[EIP20]: https://eips.ethereum.org/EIPS/eip-20 "ERC-20"
[EIP4361]: https://eips.ethereum.org/EIPS/eip-4361 "Sign-In with Ethereum"
[EIP712]: https://eips.ethereum.org/EIPS/eip-712 "EIP-712 typed structured data"
[FASTIFY_SCHEMA]: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/ "Fastify validation/serialization"
[OZ_SAFE]: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.4.0/contracts/token/ERC20/utils/SafeERC20.sol "SafeERC20 v5.4.0"
[PG_CLIENT]: https://node-postgres.com/features/transactions "node-postgres transactions"
[RPC_CODE]: https://github.com/ethereum/execution-apis/blob/main/src/eth/transaction.yaml "Execution API transaction schema"
[VIEM_SIWE_CODE]: https://github.com/wevm/viem/blob/main/src/actions/siwe/verifySiweMessage.ts "viem SIWE source"
