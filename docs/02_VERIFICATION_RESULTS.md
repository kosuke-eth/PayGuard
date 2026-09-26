# PayGuard verification ledger

## 2. Verification results

**Ledger:** 107 confirmed, 103 partially correct, 10 incorrect, and 7 unverifiable. A confirmed mechanism or coherent design rule is not a claim that PayGuard has been implemented. A partially correct compound assertion can contain a serious defect.

For each item, the finding is the correction/disposition. References point to retrieved external evidence; input line provenance is in section 1. Where a conclusion follows directly from the draft or arithmetic rather than an external fact, the basis is stated explicitly.

### C001: confirmed

These are different responsibilities. Authorization can reject before conversion; LP compensation and transaction gas are separate funding flows. Keeping their state owners distinct is a coherent design.

**Basis:** technical/design assessment. **Sources:** [EIP712] [V4_MANAGER] [EIP1559]

### C002: partially correct

EVM rollback and signature verification support this architecture, but the draft is not an executable kernel. It leaves the Payment type, signature path, budget units, and shared-ledger debit incomplete.

**Basis:** technical/design assessment. **Sources:** [EIP140] [EIP712] [SOL_SECURITY]

### C003: confirmed

A vault can enforce signatures, counters and a plain-token transfer without any named protocol or identity provider. That proves a smaller product boundary, not the original multi-protocol settlement claim.

**Basis:** technical/design assessment. **Sources:** [EIP20] [EIP712] [OZ_SAFE]

### C004: partially correct

Exact signed fields plus correctly implemented consumption constrain mutation and reuse. They do not prove human-readable consent, prevent spending every outstanding slot, or control timing/exclusivity that is not encoded.

**Basis:** technical/design assessment. **Sources:** [EIP712] [OZ_SIG] [MERKLE_CODE]

### C005: unverifiable

No retrieved source can determine implementation duration for this team, and the request expressly excludes timeline judgments. Remove the one-month target rather than accept or refute it.

**Basis:** excluded timeline judgment. **Sources:** Supplied-draft inspection or an unavailable artifact, as stated in the finding; no external confirmation claimed. **Open items:** O01.

### C006: partially correct

A small immutable core and bounded integrations are sound proposed boundaries. Direct same-token transfer does not need its own external adapter, and optional integrations do not satisfy the original combined-path promise by themselves.

**Basis:** technical/design assessment. **Sources:** [EIP20] [V4_INTERFACE] [SWAPVM_CODE]

### C007: confirmed

Fastify request handling, PostgreSQL transactions/locking and viem RPC operations supply the required mechanisms. The outbox and recovery state machine remain application code, not built-in exactly-once delivery.

**Basis:** technical/design assessment. **Sources:** [FASTIFY_SCHEMA] [PG_CLIENT] [PG_LOCK] [VIEM_RECEIPT]

### C008: partially correct

Separating owner and agent keys is feasible. A gas-paying relayer still needs a verified original-agent signature at the vault; merely forwarding an agent-signed EOA transaction does not make it gas-sponsored.

**Basis:** technical/design assessment. **Sources:** [EIP712] [EIP2771] [EIP1559]

### C009: confirmed

Treat canonical contract state and successful execution as payment evidence, with SQL storing orchestration and projections. SQL and the blockchain are separate commit domains; no shared transaction is provided.

**Basis:** technical/design assessment. **Sources:** [PG_ISOLATION] [RPC_DOC] [EIP140]

### C010: partially correct

This is a required postcondition, not a fact established by the draft. Bind recipient in the signed intent and verify exact plain-token receipt after settlement; forbid vault/adapter recipient aliases in the proposed P0.

**Basis:** technical/design assessment. **Sources:** [EIP712] [EIP20] [V4_INTERFACE]

### C011: partially correct

A consumed mapping checked and written before external calls can enforce one canonical success per key. Add an invoice-consumption key across new intents/policy versions; distinct slots alone can still authorize the same invoice twice.

**Basis:** technical/design assessment. **Sources:** [EIP712] [SOL_SECURITY] [EIP140]

### C012: partially correct

Balance postconditions support bounded settlement, but reported adapter return values are insufficient. Exact-output should use an explicit equality requirement; input ceilings need owner authorization, not only an agent-selected number.

**Basis:** technical/design assessment. **Sources:** [EIP20] [V4_INTERFACE] [OZ_SAFE]

### C013: confirmed

A revert propagated by the outer payment transaction rolls back its contract-state writes and nested transfers. Gas paid by the transaction sender and prior off-chain actions are not rolled back.

**Basis:** technical/design assessment. **Sources:** [EIP140] [SOL_GLOBALS] [EIP1559]

### C014: partially correct

Implement owner-only policy creation and exact, nonce-protected exception signatures. The draft does not yet define which limit an exception may override; the rebuilt design permits only the automatic per-payment threshold.

**Basis:** technical/design assessment. **Sources:** [EIP712] [EIP1271] [OZ_SIG]

### C015: partially correct

Domain, revocation and expiry checks can enforce this, but supersession is not automatic. Define an on-chain active policy/version or explicit revocation rule and test boundary ordering.

**Basis:** technical/design assessment. **Sources:** [EIP712] [SOL_GLOBALS] [OZ_SIG]

### C016: partially correct

For supported ordinary ERC-20 tokens, set a finite allowance and clear the remainder after settlement. Standard forceApprove is not a universally transient approval and does not clear separate temporary-allowance mechanisms.

**Basis:** technical/design assessment. **Sources:** [EIP20] [OZ_TOKEN_DOC] [OZ_SAFE]

### C017: partially correct

Rebuilding is feasible only if all required raw events, ABI/deployment context and signed artifacts are retained. The draft event list omits deposit/withdrawal evidence for its promised shared-ledger rebuild; off-chain attempts are not reconstructible from chain logs.

**Basis:** technical/design assessment. **Sources:** [RPC_DOC] [SOL_ABI] [PG_JSON]

### C018: confirmed

The on-chain predicate can validate only its chosen inputs and trusted state. Reusing a compromised agent as the authority for category or merchant identity does not independently constrain that agent.

**Basis:** technical/design assessment. **Sources:** [EIP712] [ENS_CODE] [SOL_SECURITY]

### C019: partially correct

Independent trustworthy classification is necessary for a meaningful category rule. Permanent immutability and a finite merchant list are not universal requirements: a deliberately trusted live registry with explicit update/revocation semantics can also work.

**Basis:** technical/design assessment. **Sources:** [ENS_DOC] [ENS_CODE] [EIP712]

### C020: partially correct

Combining exact slots with aggregate caps narrows authority, but is not universally superior for autonomous procurement. It removes choices the original product intended to delegate; bounded policies with authenticated merchants are a different valid mode.

**Basis:** technical/design assessment. **Sources:** [EIP712] [SOL_SECURITY] **Open items:** O02.

### C021: partially correct

Separating authorization state from protocol adapters reduces coupling by construction. It is a design preference, not a proven performance result, and substituting independent paths changes the original serial integration.

**Basis:** technical/design assessment. **Sources:** [V4_INTERFACE] [SWAPVM_CODE]

### C022: confirmed

REVERT discards logs in reverted execution, and a genuinely view/static evaluation cannot persist an event. A blocked simulation and an on-chain denial record are different evidence.

**Basis:** technical/design assessment. **Sources:** [EIP140] [SOL_GLOBALS]

### C023: confirmed

Store the signed attempted payload, simulation block and decoded failure off-chain. This is evidence that the service observed an attempt, not proof a blocked event survived on-chain.

**Basis:** technical/design assessment. **Sources:** [EIP712] [VIEM_SIM] [EIP140]

### C024: confirmed

A separate successful attempt-recording transaction can emit a denial event. Its receipt status then describes that recording transaction; clients must not equate it with token settlement.

**Basis:** technical/design assessment. **Sources:** [EIP140] [RPC_CODE] [SOL_ABI]

### C025: partially correct

A single settlement-token counter avoids USD conversion for that counter. It does not establish a dollar peg or protect the value of RWA sold: enforce separate owner-approved input-asset ceilings. Define fixed 86400-second epochs explicitly.

**Basis:** technical/design assessment. **Sources:** [EIP20] [SOL_GLOBALS] [PG_NUMERIC]

### C026: confirmed

Canonical EVM state excludes orphaned executions; off-chain projections must follow the canonical branch. Approval reservation is a separate state machine and is not implied by signing.

**Basis:** technical/design assessment. **Sources:** [RPC_DOC] [ETH_FINALITY] [EIP712]

### C027: partially correct

Freshness, units and relevant L2 availability checks are real oracle concerns. Whether a particular feed, deviation guard or sequencer feed exists depends on the chosen deployment; there is no oracle requirement for the proposed token-unit budgets.

**Basis:** technical/design assessment. **Sources:** [CHAINLINK] [EIP20] **Open items:** O07.

### C028: partially correct

Aggregate caps bound multiple valid payments; recipient/domain binding blocks the specified substitutions. Invoice hashes alone do not stop duplicate authorized slots or independently issued new invoices: explicit consumption/objective rules are needed.

**Basis:** technical/design assessment. **Sources:** [EIP712] [SOL_SECURITY]

### C029: incorrect

Mandatory exact merchant/invoice/amount/route preapproval removes autonomous choice. It is a functional scope change, not merely structural decomposition. Keep exact-slot mode optional and rebuild P0 around owner-bounded policies.

**Basis:** direct comparison with original product and draft outside-voice analysis. **Sources:** [EIP712]

### C030: confirmed

The proposed trust boundaries are coherent requirements. A role name alone supplies no enforcement; the vault must verify the relevant signer/caller and constrain all fund-moving interfaces.

**Basis:** technical/design assessment. **Sources:** [SOL_SECURITY] [EIP712] [EIP2771]

### C031: partially correct

A wallet signature and/or authorized configuration transaction establishes the specified authority, depending on the chosen activation model. A websocket message proves neither canonical inclusion nor consensus finality.

**Basis:** technical/design assessment. **Sources:** [EIP712] [RPC_DOC] [ETH_FINALITY]

### C032: partially correct

The durable row can be the delivery source of truth. It does not establish exactly-once external effects: a crash after delivery but before acknowledgment requires idempotent handling and retained event identity.

**Basis:** technical/design assessment. **Sources:** [PG_CLIENT] [PG_LOCK] [BULL_IDEMP]

### C033: partially correct

Bounded serverless invocation lifetimes are a hosting constraint, not an inherent Next.js limitation. A long-lived worker is a useful choice; self-hosted Next.js is also possible.

**Basis:** technical/design assessment. **Sources:** [NEXT_SELF] [VERCEL_LIMIT]

### C034: partially correct

Both decompositions are technically possible. Choosing one API and one worker is a demo-scope decision, not evidence that microservices or Next.js are technically incapable.

**Basis:** technical/design assessment. **Sources:** [FASTIFY_SCHEMA] [NEXT_SELF] [PG_CLIENT]

### C035: confirmed

A shared schema/ABI package can be consumed by API, worker and future client. Generate the contract-facing data from the actual build; no UI framework needs to be selected now.

**Basis:** technical/design assessment. **Sources:** [SOL_ABI] [FOUNDRY_DEPLOY] [FASTIFY_SCHEMA]

### C036: confirmed

PostgreSQL locking and transactional writes can implement a small durable work queue. Redis or Kafka is not required for this design; queue handlers still require replay-safe effects.

**Basis:** technical/design assessment. **Sources:** [PG_LOCK] [PG_CLIENT] [BULL_IDEMP]

### C037: partially correct

Both representations are viable. Relative gas cost depends on slot size, proof length, storage transitions and calldata costs; do not assert a universal gas winner without measurements.

**Basis:** technical/design assessment. **Sources:** [MERKLE_DOC] [MERKLE_CODE] [SOL_ABI]

### C038: confirmed

A newly signed exact payment requires the owner at signing time. Advance signing permits unattended later execution but only within the preapproved fields and time bounds.

**Basis:** technical/design assessment. **Sources:** [EIP712] [OZ_SIG]

### C039: partially correct

The listed fields are present, but period limits, input budgets, subsidy mode and policy override semantics are missing. Optional metadata does not prove meaningful consent to an opaque root.

**Basis:** draft schema inspection plus cryptographic semantics. **Sources:** [EIP712] [MERKLE_DOC]

### C040: partially correct

The slot binds many useful fields, but does not encode the promised subsidyRequired/bestEffort mode, and objectiveId has no sequencing behavior. Require outputToken to equal the policy settlement token.

**Basis:** draft schema inspection. **Sources:** [EIP712] [SOL_ABI]

### C041: partially correct

A zero-address wildcard is an application convention, not ERC-20 behavior. It risks colliding with native-currency conventions and defeats exact asset binding unless separately specified. Disallow wildcard input assets in P0.

**Basis:** technical/design assessment. **Sources:** [EIP20] [SOL_ABI] [V4_INTERFACE]

### C042: partially correct

Type/domain binding is useful, but manifestId is undefined. Hashing a header containing slotsRoot into manifestId while leaves contain manifestId creates a circular construction. Use a root-independent scopeId. Also match the chosen tree library: StandardMerkleTree uses double-hashed ABI leaves, not the draft single-hash formula.

**Basis:** technical/design assessment. **Sources:** [EIP712] [MERKLE_DOC] [MERKLE_CODE] **Open items:** O03.

### C043: partially correct

Golden vectors can show two implementations agree on supplied fixtures. They do not prove the human saw the leaf contents, that every field is bound, or that all inputs behave correctly; add mutation tests and clear signing data.

**Basis:** technical/design assessment. **Sources:** [EIP712] [MERKLE_CODE] [FOUNDRY_TEST]

### C044: confirmed

Packed dynamic encodings can be ambiguous. Typed ABI encoding and explicit hashing of dynamic fields avoid that particular ambiguity; both sides must use exactly the same types and ordering.

**Basis:** technical/design assessment. **Sources:** [SOL_ABI] [SOL_GLOBALS] [EIP712]

### C045: partially correct

The proposed lifecycle is implementable, but EXHAUSTED should not follow SUPERSEDED as drawn. Expiry/exhaustion are derived predicates; replacement and revocation are independent invalidation reasons.

**Basis:** state-machine consistency review. **Sources:** [EIP712] [SOL_GLOBALS]

### C046: confirmed

Version numbering alone has no contract effect. Implement explicit replacement or a minimum-valid-version/active-ID check; ordinary activation must not silently grant access to superseded policies.

**Basis:** technical/design assessment. **Sources:** [EIP712] [SOL_SECURITY]

### C047: confirmed

Expiry and caller-domain comparisons are implementable. A revocation transaction changes subsequent canonical execution, not prior successful transfers; ordering determines a race with an agent payment.

**Basis:** technical/design assessment. **Sources:** [SOL_GLOBALS] [EIP140] [RPC_DOC]

### C048: partially correct

The distinctions are useful, but decision, submission state, chain confidence and reconciliation are separate axes. A reverted receipt is terminal for that transaction, not necessarily for the unpaid invoice.

**Basis:** technical/design assessment. **Sources:** [RPC_CODE] [VIEM_RECEIPT] [ETH_FINALITY]

### C049: confirmed

A conditional UPDATE can implement compare-and-set. Require exactly one affected row and perform dependent event/outbox writes in the same SQL transaction; it cannot lock blockchain state.

**Basis:** technical/design assessment. **Sources:** [PG_ISOLATION] [PG_CLIENT] [PG_CONSTRAINT]

### C050: partially correct

Exact intent, nonce and expiry are appropriate. The draft still needs an approver authorization rule, explicit override scope, on-chain nonce consumption and cancellation behavior.

**Basis:** technical/design assessment. **Sources:** [EIP712] [EIP1271] [OZ_SIG]

### C051: confirmed

A signed approval does not reserve assets or budget. Execution can recheck all hard constraints, with an explicit capacity-changed result when the state no longer permits payment.

**Basis:** technical/design assessment. **Sources:** [EIP712] [VIEM_SIM] [SOL_SECURITY]

### C052: confirmed

A DB reservation cannot serialize an independently submitted chain transaction. On-chain reservation can do so only with additional creation/release/expiry rules.

**Basis:** technical/design assessment. **Sources:** [PG_ISOLATION] [RPC_DOC] [EIP140]

### C053: partially correct

Deposited-token custody is implementable; smart-account modules/permissions are separate integrations. The draft does not demonstrate their compatibility with the selected wallet, deployment or vault API.

**Basis:** technical/design assessment. **Sources:** [EIP20] [EIP4337] [EIP7715] **Open items:** O04.

### C054: partially correct

An allowance alone is only a spender/amount grant. A policy-enforcing approved router could add the missing rules, so rejecting every EOA-allowance architecture is too broad. The selected per-owner vault is a simpler explicit boundary.

**Basis:** technical/design assessment. **Sources:** [EIP20] [SOL_SECURITY]

### C055: incorrect

One contract holding multiple owners assets is pooled custody even with an internal ledger. The accounting separation does not make custody non-omnibus. Use a per-owner vault to remove this ambiguity and shared-ledger requirement.

**Basis:** direct consequence of the draft custody layout. **Sources:** [EIP20] [OZ_TOKEN_DOC]

### C056: partially correct

Per-owner contracts separate their token holdings, but common code can retain common vulnerabilities. Deployment and indexing costs depend on the implementation; the draft provides no gas or operational benchmark.

**Basis:** technical/design assessment. **Sources:** [EIP20] [SOL_SECURITY] [FOUNDRY_DEPLOY]

### C057: partially correct

These are appropriate responsibilities, but the execution sequence must actually implement every one. In particular, shared-custody debits and input/output postconditions are not satisfied by incrementing spending counters alone.

**Basis:** technical/design assessment. **Sources:** [EIP20] [EIP140] [SOL_SECURITY]

### C058: confirmed

A typed settlement interface can separate the kernel from each protocol. An adapter may convert assets without becoming a second authority owner; subsidy accounting remains distinct.

**Basis:** technical/design assessment. **Sources:** [SWAPVM_CODE] [V4_INTERFACE] [EIP712]

### C059: partially correct

An integrated registry reduces deployment/call boundaries. Separate contracts called synchronously are also atomic when failures propagate, so integration is not required for atomicity.

**Basis:** technical/design assessment. **Sources:** [EIP140] [SOL_GLOBALS]

### C060: partially correct

Relayed activation is feasible with a valid owner signature, domain, nonce and explicit replace mode. The draft has no complete manifestId derivation or activation replay rule; do not implement the illustrative signature unchanged.

**Basis:** technical/design assessment. **Sources:** [EIP712] [EIP1271] [OZ_SIG]

### C061: partially correct

The API is implementable with supported-token transfer checks. In shared custody, withdrawals require a debited owner ledger; in the chosen per-owner vault, the immutable owner controls the whole balance.

**Basis:** technical/design assessment. **Sources:** [EIP20] [OZ_SAFE] [SOL_SECURITY]

### C062: partially correct

Revocation must be scoped to this owner/vault. Define whether agent revocation is permanent or epoch-based; a DB-only agent status update cannot revoke contract authority.

**Basis:** technical/design assessment. **Sources:** [EIP712] [SOL_GLOBALS]

### C063: partially correct

The ABI is explicitly illustrative and leaves Payment undefined. It also lacks a separately verified agent signature needed for the advertised relayer path. The rebuilt ABI supplies exact fields and signatures.

**Basis:** technical/design assessment. **Sources:** [SOL_ABI] [EIP712] [EIP2771]

### C064: partially correct

An adapter can report amounts, but returns are not economic proof. The vault must measure its input decrease/output increase and final merchant receipt for the supported token model.

**Basis:** technical/design assessment. **Sources:** [EIP20] [OZ_SAFE] [V4_INTERFACE]

### C065: partially correct

Exact quote-byte binding is valid for a deliberately short-lived exact order, not unrestricted delayed execution. For P0 bind a fixed route and owner ceilings; obtain new estimates without committing ephemeral quote metadata into owner authority.

**Basis:** technical/design assessment. **Sources:** [EIP712] [AQUA_SDK] [V4_INTERFACE]

### C066: incorrect

A relayer sending its own funded transaction becomes msg.sender. Verify the agent signed the exact intent inside executePayment, or specify a working forwarder/account-abstraction path; an unspecified authorized redeemer is not enough.

**Basis:** technical/design assessment. **Sources:** [SOL_GLOBALS] [EIP2771] [EIP1559]

### C067: partially correct

The checks are appropriate but incomplete: enforce settlement-token equality, fixed input asset, separate input budget, invoice uniqueness across retries/versions, and a defined exception matrix.

**Basis:** technical/design assessment. **Sources:** [EIP712] [EIP20] [SOL_SECURITY]

### C068: partially correct

The sequence can be atomic, but it omits the shared owner-ledger reserve/debit/refund. Finite approve plus clearing is not universally transient authority. The per-owner P0 avoids this ledger omission and still checks real deltas.

**Basis:** technical/design assessment. **Sources:** [EIP140] [EIP20] [OZ_SAFE] [SOL_SECURITY]

### C069: partially correct

Use both here because the vault calls adapters and tokens. Neither pattern is a universal requirement for every possible design, and a guard does not substitute for correct callback/context accounting.

**Basis:** technical/design assessment. **Sources:** [SOL_SECURITY] [OZ_GUARD] [V4_MANAGER]

### C070: confirmed

The token exposes only the aggregate balance of the vault address. It has no built-in record of which depositor owns which part.

**Basis:** technical/design assessment. **Sources:** [EIP20] [OZ_TOKEN_DOC]

### C071: partially correct

The conservation equation is appropriate for the restricted shared-vault model. Aggregate coverage requires actual enforcement and ledger updates on every deposit, spend and withdrawal; it is not established by a SQL projection.

**Basis:** technical/design assessment. **Sources:** [EIP20] [OZ_SAFE] [SOL_SECURITY]

### C072: confirmed

Simple exact-delta assumptions are not valid for arbitrary token semantics. Use an explicit supported-token deployment list; a generic interface check cannot reliably detect every fee, rebase or callback behavior.

**Basis:** technical/design assessment. **Sources:** [EIP20] [OZ_SAFE] [AQUA_AUDIT]

### C073: confirmed

The retrieved audit discusses token/accounting assumptions and related issues. Its conclusions apply to the identified reviewed commits, not every current branch or the new PayGuard code.

**Basis:** technical/design assessment. **Sources:** [AQUA_AUDIT] [AQUA_CODE]

### C074: partially correct

Observed balances are necessary for the proposed restricted-token design. Measuring a deposit delta does not alone make fee-on-transfer tokens safe for later exact-output settlement; retain the explicit token restriction.

**Basis:** technical/design assessment. **Sources:** [EIP20] [OZ_SAFE] [AQUA_AUDIT]

### C075: partially correct

Execution-only pause with separate withdraw/revoke entry points is implementable. It cannot guarantee withdrawal if the token itself freezes/reverts or the chain is unavailable; test the application-controlled pause behavior only.

**Basis:** technical/design assessment. **Sources:** [SOL_SECURITY] [OZ_GUARD] [EIP20]

### C076: partially correct

Separate authorities are coherent requirements. For the demo use immutable adapters and an owner execution pause rather than introducing unverified governance, multisig and upgrade machinery.

**Basis:** technical/design assessment. **Sources:** [SOL_SECURITY] [EIP712]

### C077: partially correct

An immutable adapter list removes that specific insertion capability. It does not freeze a proxy implementation at a listed address or prove adapter safety; use the inspected non-upgradeable local implementations.

**Basis:** technical/design assessment. **Sources:** [SOL_SECURITY] [SOL_ABI]

### C078: partially correct

The events correlate payments but do not cover every state the draft promises to rebuild. Add policy payload/configuration discovery, deposits/withdrawals where required, cancellation and subsidy events; preserve the actual emitting address.

**Basis:** technical/design assessment. **Sources:** [SOL_ABI] [RPC_CODE] [EIP20]

### C079: confirmed

Contracts cannot use their historical event stream as ordinary storage. Authorization must use current contract state and supplied verified data, not a database assertion about an event.

**Basis:** technical/design assessment. **Sources:** [SOL_GLOBALS] [SOL_ABI] [RPC_DOC]

### C080: confirmed

Custom errors have ABI identities and can be mapped to stable application codes. Include the actual error ABI when decoding, and distinguish unknown provider failures rather than parsing arbitrary message strings.

**Basis:** technical/design assessment. **Sources:** [SOL_ABI] [VIEM_SIM] [VIEM_SIM_CODE]

### C081: confirmed

These domain fields are defined by EIP-712. Include the correct deployed verifier and chain; changing only a frontend label does not create domain separation.

**Basis:** technical/design assessment. **Sources:** [EIP712] [OZ_CRYPTO] [OZ_SIG]

### C082: confirmed

SignatureChecker supports EOA/contract validation and ECDSA helpers enforce canonical signature rules. ERC-1271 validity may change with contract state; validate again at execution rather than cache an everlasting approval.

**Basis:** technical/design assessment. **Sources:** [EIP1271] [OZ_SIG] [OZ_CRYPTO]

### C083: partially correct

The layers address distinct replay domains, but EIP-712 itself has no consumed-nonce state. Also prevent reuse of one invoice through a fresh slot/policy and distinguish API request nonces from chain execution nonces.

**Basis:** technical/design assessment. **Sources:** [EIP712] [OZ_SIG] [EIP20]

### C084: partially correct

Stateful invariant campaigns can exercise these properties. Passing randomized tests is not a formal proof, and the draft inputSpent-versus-settlementBudget invariant is wrong until its units are corrected.

**Basis:** technical/design assessment. **Sources:** [FOUNDRY_TEST] [EIP20] [EIP140]

### C085: incorrect

inputSpent may be RWA base units while totalBudget is settlement-token base units. Count merchant output against outputBudget, require matching settlement token, and enforce input spending against a separate input-denominated budget.

**Basis:** dimensional analysis of draft lines 123 and 607. **Sources:** [EIP20] [SOL_ABI]

### C086: confirmed

The current ERC describes these request/response concepts and does not exhaustively standardize application-specific rule types. Raw RPC shapes and versioned SDK convenience shapes must not be interchanged.

**Basis:** technical/design assessment. **Sources:** [EIP7715] [METAMASK_RPC]

### C087: confirmed

Query the actual browser wallet and inspect returned grants, not just a static network list. Current MetaMask SDK examples differ from older Context7 snippets; pin the chosen SDK before relying on their shape.

**Basis:** technical/design assessment. **Sources:** [EIP7715] [METAMASK_RPC] [METAMASK_NET]

### C088: confirmed

The permission context and dependencies affect redemption, and the specification requires returned undeployed dependencies to be deployed. PayGuard revocation is independent unless explicitly coupled in code.

**Basis:** technical/design assessment. **Sources:** [EIP7715] [METAMASK_RPC]

### C089: confirmed

A vault can verify an owner-bound agent signature without ERC-7715. This is native PayGuard authorization, not proof that the wallet permission standard was integrated.

**Basis:** technical/design assessment. **Sources:** [EIP712] [OZ_SIG] [EIP7715]

### C090: confirmed

Aqua keeps actual maker assets in the maker wallet while managing strategy virtual balances. ship/dock are not deposits/withdrawals of custody; actual balance and allowance still determine whether a fill can execute.

**Basis:** technical/design assessment. **Sources:** [AQUA_CODE] [AQUA_SDK] [AQUA_AUDIT]

### C091: partially correct

Instruction order matters, but Aqua-mode orders are authorized through shipped strategy balances, not necessarily an off-chain maker signature. The router also has a separate signature-authorized path.

**Basis:** technical/design assessment. **Sources:** [SWAPVM_CODE] [SWAPVM_OPS] [AQUA_SDK]

### C092: partially correct

A custom fund-moving opcode adds code and settlement interactions. A bounded adapter is smaller only if it actually constrains the stock router program, tokens, traits and recipient; neither is verified merely by naming it.

**Basis:** technical/design assessment. **Sources:** [SWAPVM_CODE] [SWAPVM_OPS] [AQUA_AUDIT]

### C093: partially correct

The stock-router adapter is feasible in the taker role with an explicitly funded maker strategy and matching encoding. It is not automatically a v4 route, and the selected deployment/pool still needs a running transaction test.

**Basis:** technical/design assessment. **Sources:** [AQUA_SDK] [SWAPVM_CODE] [AQUA_ROUTING] **Open items:** O05.

### C094: confirmed

These are relevant protocol boundaries. In particular, distinguish the maker receiving Aqua input from the taker choosing output delivery; a generic receiver field cannot be assumed to control both legs.

**Basis:** technical/design assessment. **Sources:** [SWAPVM_CODE] [AQUA_SDK] [AQUA_AUDIT]

### C095: partially correct

A unique salt can separate strategies but does not itself encode or enforce all listed fields or prevent repeated fills. Bind the actual program/tuple, and use invoice/intent consumption for PayGuard replay protection.

**Basis:** technical/design assessment. **Sources:** [AQUA_CODE] [SWAPVM_CODE] [EIP712]

### C096: partially correct

An outer transaction can receive output in the vault and forward exact tokens atomically. Identical bytecode does not guarantee quote/swap equality across changed state or prove allowances/settlement will succeed.

**Basis:** technical/design assessment. **Sources:** [EIP140] [SWAPVM_CODE] [EIP20] [AQUA_AUDIT]

### C097: confirmed

The retrieved independent audit addresses these classes, including receiver traits and external-logic/accounting boundaries. Remediation status is item- and commit-specific; do not transplant historical findings onto every later version.

**Basis:** technical/design assessment. **Sources:** [AQUA_AUDIT] [SWAPVM_CODE] [AQUA_CODE]

### C098: partially correct

Use one state owner for consumption. A read-only mirror must recognize the current authenticated in-flight execution; simply calling evaluate again after the kernel consumed a slot can reject a legitimate payment.

**Basis:** technical/design assessment. **Sources:** [SOL_SECURITY] [V4_IDENTITY] [SWAPVM_CODE]

### C099: confirmed

Permission bits are part of the hook address and the official real-network workflow mines a CREATE2 salt. Verify the actual deployer and constructor bytecode; Foundry address-placement cheatcodes do not prove deployment.

**Basis:** technical/design assessment. **Sources:** [V4_DEPLOY] [V4_HOOK_INTERFACE] [V4_MANAGER]

### C100: confirmed

Use a dynamic pool and a valid override flag. Explicit zero override is OVERRIDE_FEE_FLAG, not plain zero. The initial dynamic LP fee is zero, so fallback must explicitly select the intended normal fee.

**Basis:** technical/design assessment. **Sources:** [V4_FEE] [V4_MANAGER] [V4_HOOK_INTERFACE]

### C101: confirmed

The hook is called by PoolManager; the passed sender identifies the direct swap caller, usually a router. Authenticate the originating vault/intent through a constrained adapter rather than treating sender as the agent.

**Basis:** technical/design assessment. **Sources:** [V4_IDENTITY] [V4_HOOK_INTERFACE] [V4_MANAGER]

### C102: confirmed

The manager checks that its outstanding currency-delta count is zero after unlockCallback. Debts/credits belong to individual callers; settling for the wrong address is not equivalent to settling the adapter.

**Basis:** technical/design assessment. **Sources:** [V4_MANAGER] [V4_INTERFACE]

### C103: confirmed

A hook can be referenced by other PoolKeys unless its callbacks reject them. Validate the pinned manager, token ordering, fee mode, tick spacing and allowed initialization context.

**Basis:** technical/design assessment. **Sources:** [V4_DEPLOY] [V4_MANAGER] [V4_HOOK_INTERFACE]

### C104: confirmed

A zero LP fee merely stops that fee accruing. Use an actual accounting operation such as funded donate, or describe the alternative as a rebate; a counter decrement alone does not pay LPs.

**Basis:** technical/design assessment. **Sources:** [V4_FEE] [V4_INTERFACE] [V4_POOL]

### C105: confirmed

Hook-return deltas are supported, with specific permission and sign conventions. P0 avoids custom-return deltas and uses ordinary settlement plus a separately funded donation branch.

**Basis:** technical/design assessment. **Sources:** [V4_HOOK_INTERFACE] [V4_MANAGER]

### C106: partially correct

A prefunded rebate is constructively possible, but simpler is an implementation judgment. It is a different economic promise from zero LP fee plus merchant-funded LP compensation, especially when currencies differ.

**Basis:** technical/design assessment. **Sources:** [V4_FEE] [V4_INTERFACE] [EIP20]

### C107: confirmed

Network transaction gas, LP swap fees and protocol fees are different charges and recipients. An LP fee override does not fund the relayer or guarantee zero payer price impact.

**Basis:** technical/design assessment. **Sources:** [EIP1559] [V4_FEE] [V4_MANAGER]

### C108: partially correct

These checks are necessary, but the draft omits the rebate denomination/conversion rule. Choose one explicit asset and formula before writing a subsidy branch; no implicit USD equivalence is assumed.

**Basis:** technical/design assessment. **Sources:** [EIP20] [V4_MANAGER] [V4_POOL]

### C109: confirmed

Each fallback is an application policy that must be committed and checked. If fallback input exceeds the owner-authorized ceiling, revert rather than silently spend extra.

**Basis:** technical/design assessment. **Sources:** [EIP712] [V4_FEE] [V4_INTERFACE]

### C110: incorrect

The prose requires subsidyRequired/bestEffort, but neither field appears in the supplied SpendSlot. Add a signed subsidyMode and maximum subsidy to the actual schema or remove the unsupported promise.

**Basis:** direct comparison of draft lines 268-284 and 716. **Sources:** [EIP712] [SOL_ABI]

### C111: confirmed

Untrusted invoice text cannot establish independent category authority. Owner-pinned recipients/invoice signers or an explicitly trusted issuer are workable trust models; no general natural-language classifier is required.

**Basis:** technical/design assessment. **Sources:** [EIP712] [ENS_CODE]

### C112: confirmed

ENS supports authorized text-record updates, and backend JSON is mutable application data. Commit a reviewed snapshot or deliberately specify trusted live updates; do not call either intrinsically immutable.

**Basis:** technical/design assessment. **Sources:** [ENS_DOC] [ENS_CODE] [PG_JSON]

### C113: confirmed

Once the contract holds the authorized recipient/signing data, execution need not call ENS or an external registry. Availability of those discovery services need not gate a valid payment.

**Basis:** technical/design assessment. **Sources:** [EIP712] [SOL_SECURITY] [EIP20]

### C114: partially correct

Settlement-token units do not need a USD oracle. Input-asset exposure still requires a separately bound limit. Oracle checks are feed/network-specific; a blanket answeredInRound rule or assumed sequencer feed should not be added without verification.

**Basis:** technical/design assessment. **Sources:** [EIP20] [CHAINLINK] **Open items:** O07.

### C115: confirmed

The responsibility split is coherent. It can be implemented as modules in one API and one worker rather than ten microservices; those are proposed boundaries, not an existing implementation.

**Basis:** technical/design assessment. **Sources:** [FASTIFY_SCHEMA] [PG_CLIENT] [VIEM_RECEIPT]

### C116: partially correct

This is a valid application idempotency contract, not automatic POST behavior. Persist the canonical request hash, resource and original response; keep concurrency handling inside SQL transactions.

**Basis:** technical/design assessment. **Sources:** [PG_CONSTRAINT] [PG_ISOLATION] [PG_CLIENT]

### C117: confirmed

Use strict integer decimal strings over JSON and bigint internally. Reject JSON numeric amounts before coercion; JavaScript number cannot represent arbitrary uint256 exactly.

**Basis:** technical/design assessment. **Sources:** [SOL_ABI] [PG_NUMERIC] [FASTIFY_SCHEMA]

### C118: confirmed

Store a validated 20-byte address and explicit deployment/chain context. Checksummed display is presentation, not a separate identity; same-chain local resets additionally need a deployment instance ID.

**Basis:** technical/design assessment. **Sources:** [SOL_ABI] [EIP1193] [RPC_DOC]

### C119: partially correct

The proposed routes are not existing third-party APIs. A backend can report configured capability expectations, but actual wallet permission discovery must run against the connected browser wallet provider.

**Basis:** technical/design assessment. **Sources:** [EIP1193] [EIP7715] [METAMASK_RPC]

### C120: confirmed

Creating a database row authenticates or registers a service identity only. Contract authority requires an owner-authorized on-chain policy or a verified owner-signed authorization in the selected design.

**Basis:** technical/design assessment. **Sources:** [EIP712] [SOL_SECURITY] [PG_ISOLATION]

### C121: partially correct

These are implementable custom endpoints, not verified existing interfaces. Their exact contracts depend on fixing root construction, signature domain and activation semantics; P0 instead exposes policy drafts and owner configuration transactions.

**Basis:** technical/design assessment. **Sources:** [FASTIFY_SCHEMA] [EIP712] [MERKLE_CODE]

### C122: confirmed

An immutable compiled payload/hash is a coherent design. Store exact encoded bytes as well as a parsed projection; do not regenerate authoritative bytes from jsonb and assume identity.

**Basis:** technical/design assessment. **Sources:** [PG_JSON] [JCS] [EIP712]

### C123: partially correct

The custom workflow is viable after distinguishing logical payment, signed intent versions and transaction attempts. This prevents a failed quote or replacement transaction from creating another payable invoice.

**Basis:** technical/design assessment. **Sources:** [FASTIFY_SCHEMA] [PG_CONSTRAINT] [VIEM_RECEIPT]

### C124: confirmed

The client should request actions, not assert settlement status. Service transitions and verified chain observations control status; database permissions should match that separation.

**Basis:** technical/design assessment. **Sources:** [PG_ISOLATION] [RPC_CODE] [EIP712]

### C125: partially correct

These are proposed endpoints with application-level authorization requirements. Webhooks and full reconciliation operations are optional for the demo; health readiness must detect unavailable DB/RPC/configuration.

**Basis:** technical/design assessment. **Sources:** [FASTIFY_SCHEMA] [PG_CLIENT] [RPC_DOC]

### C126: confirmed

A durable unique operation key and request hash can implement replay-safe API commands. Leases must not permit a second logical resource after a worker crash; return the existing operation identity.

**Basis:** technical/design assessment. **Sources:** [PG_CONSTRAINT] [PG_LOCK] [PG_CLIENT]

### C127: confirmed

One checked-out PostgreSQL client can atomically insert the domain row, idempotency row and work item. Use ON CONFLICT rather than continuing a transaction after an unhandled unique-violation error.

**Basis:** technical/design assessment. **Sources:** [PG_CLIENT] [PG_ISOLATION] [PG_CONSTRAINT]

### C128: partially correct

The entities are suitable starting points, not a complete enforceable schema. Add explicit deployment foreign keys, owner-scoped access, invoice replay keys, signed-byte storage and input/output units.

**Basis:** technical/design assessment. **Sources:** [PG_CONSTRAINT] [PG_JSON] [PG_NUMERIC]

### C129: partially correct

The operational entities support recovery, but transactions and receipts are different: one tx can appear on competing branches. Preserve receipt/log observations with block hashes and separate canonical projections.

**Basis:** technical/design assessment. **Sources:** [RPC_CODE] [RPC_DOC] [PG_CONSTRAINT]

### C130: partially correct

The indexes are useful but require exact predicates and null/foreign-key rules. A decimal column alone does not enforce uint256, and transaction-hash uniqueness is not logical-payment idempotency.

**Basis:** technical/design assessment. **Sources:** [PG_CONSTRAINT] [PG_PARTIAL] [PG_NUMERIC]

### C131: partially correct

That triple including tx_hash permits competing same-nonce hashes; it does not enforce one canonical winner. Use a nonce-family model plus canonical receipt constraints/checks; canonicality comes from the chain, not the SQL index.

**Basis:** technical/design assessment. **Sources:** [RPC_CODE] [PG_CONSTRAINT] [PG_PARTIAL]

### C132: partially correct

numeric(78,0) can hold uint256 magnitudes but also larger 78-digit values and rounds fractional inputs to scale zero. Use an unconstrained numeric domain with explicit integral and 0..2^256-1 checks, plus strict API strings.

**Basis:** technical/design assessment. **Sources:** [PG_NUMERIC] [SOL_ABI] [PG_CONSTRAINT]

### C133: confirmed

Prisma Decimal is not a JavaScript number and should remain a decimal string at API boundaries. This is avoidable complexity in P0, which uses pg and explicit amount::text reads.

**Basis:** technical/design assessment. **Sources:** [PRISMA_TYPES] [PG_TYPES] [PG_NUMERIC]

### C134: partially correct

The hybrid model is sound only if canonical signed evidence is stored separately as exact bytes/text. jsonb normalizes representation and cannot stand in for original signed bytes.

**Basis:** technical/design assessment. **Sources:** [PG_JSON] [JCS] [EIP712]

### C135: confirmed

Use server-generated expected SIWE content, nonce, domain, URI, chain and expiry. Atomically consume the challenge on successful verification; library signature verification alone does not enforce every service session rule.

**Basis:** technical/design assessment. **Sources:** [EIP4361] [VIEM_SIWE] [VIEM_SIWE_CODE]

### C136: confirmed

These are suitable controls for cookie-authenticated browser mutations. Retain origin/CSRF checks; SameSite is not a universal substitute. Session authentication still does not authorize a fund transfer.

**Basis:** technical/design assessment. **Sources:** [CSRF] [SESSION] [EIP4361]

### C137: partially correct

The options have different exposure and replay properties. A token or API key can suffice for proposal/read access while exact EIP-712 intent signatures independently authorize chain execution; no JWT library is required by P0.

**Basis:** technical/design assessment. **Sources:** [EIP712] [EIP4361] [SESSION]

### C138: confirmed

A custom signed envelope can bind those fields if canonical encoding and nonce checks are implemented. It does not replace the on-chain agent signature or owner policy, and it need not be a mandatory second signature over the same payment.

**Basis:** technical/design assessment. **Sources:** [EIP712] [SOL_ABI] [EIP2771]

### C139: partially correct

Both signature formats can authenticate bytes. The issuer-to-recipient binding and consumption semantics are additional application rules. P0 chooses EIP-712 and stores exact bytes, avoiding a second JWS trust path.

**Basis:** technical/design assessment. **Sources:** [EIP712] [JWS] [JCS]

### C140: incorrect

Expiry only limits the replay window, and a unique ID only provides a key. The contract must record successful consumption of that invoice identity; new intent nonces or policy versions must not reset it.

**Basis:** technical/design assessment. **Sources:** [EIP712] [EIP20]

### C141: confirmed

These tasks can be separate handlers in one persistent worker. No external queue is required; durable database state supplies restart recovery.

**Basis:** technical/design assessment. **Sources:** [PG_LOCK] [PG_CLIENT] [VIEM_RECEIPT]

### C142: partially correct

SKIP LOCKED is useful for competing workers but its row locks end with the SQL transaction. Persist a lease/fencing token before commit and make the later handler idempotent; do not hold the DB transaction open while awaiting RPC.

**Basis:** technical/design assessment. **Sources:** [PG_LOCK] [PG_CLIENT] [PG_ISOLATION]

### C143: confirmed

BullMQ explicitly advises idempotent jobs, and removed job IDs cease deduplication. The logical-payment key must outlive a queue job.

**Basis:** technical/design assessment. **Sources:** [BULL_IDEMP] [BULL_REMOVE]

### C144: partially correct

This is a sensible service policy, not a protocol guarantee. Keep payment identity fixed, bound retry count, and expose UNKNOWN rather than inventing a failed outcome after a timeout.

**Basis:** technical/design assessment. **Sources:** [BULL_IDEMP] [VIEM_RECEIPT] [RPC_DOC]

### C145: incorrect

The listed unique constraint belongs to manifest_slots, not payment_intents. Moreover, making every attempt unique by slot blocks legitimate retries. Separate one logical payment from its replaceable signed intents/transaction attempts.

**Basis:** draft schema versus concurrency diagram. **Sources:** [PG_CONSTRAINT] [PG_PARTIAL]

### C146: confirmed

eth_call observes a particular state and does not reserve it. The real transaction must recheck consumed invoice, policy validity, budget, input limits, balances and route postconditions.

**Basis:** technical/design assessment. **Sources:** [VIEM_SIM] [VIEM_SIM_CODE] [RPC_DOC]

### C147: partially correct

A locked signer row can serialize nonce allocation for one service. It cannot account for unjournaled outside use of the same key; dedicate the relayer key, persist raw signed tx before broadcast and reconcile on startup.

**Basis:** technical/design assessment. **Sources:** [PG_LOCK] [PG_CLIENT] [RPC_DOC] [EIP1559]

### C148: partially correct

ERC-4337 can support richer account/nonce models but introduces bundler, EntryPoint and paymaster compatibility. It is not inherently preferable for a demo; one dedicated, serialized relayer is an adequate chosen baseline.

**Basis:** technical/design assessment. **Sources:** [EIP4337] [EIP1559] [METAMASK_RPC]

### C149: confirmed

Conditional version updates avoid lost edits. Compiled/signed records require a new version for mutation, not an UPDATE that quietly changes approved fields.

**Basis:** technical/design assessment. **Sources:** [PG_ISOLATION] [PG_CONSTRAINT] [EIP712]

### C150: partially correct

Nonce/hash uniqueness must be enforced on-chain for execution, not only in the approvals table. Define cancellation and ensure a reorg of the consuming transaction restores the corresponding canonical state.

**Basis:** technical/design assessment. **Sources:** [EIP712] [OZ_SIG] [EIP140]

### C151: confirmed

Map known ABI errors to stable domain codes and preserve unknown infrastructure failures as such. Response schemas can constrain serialized output, but do not by themselves validate every semantic relationship.

**Basis:** technical/design assessment. **Sources:** [SOL_ABI] [VIEM_SIM] [FASTIFY_SCHEMA]

### C152: confirmed

An RPC timeout gives no proof the transaction was rejected. Recover the previously persisted hash/raw transaction rather than create another logical payment.

**Basis:** technical/design assessment. **Sources:** [RPC_DOC] [VIEM_RECEIPT_CODE] [EIP1559]

### C153: partially correct

Pin the observation block and exact calldata, but confirm provider support for block-hash selectors and gas-estimation parameters. Record a hash and recheck it when only block-number simulation is available; do not claim state cannot change before mining.

**Basis:** technical/design assessment. **Sources:** [EIP1898] [RPC_DOC] [VIEM_SIM_CODE]

### C154: confirmed

These categories distinguish deterministic invalidity from changing state and infrastructure uncertainty. Keep them separate from mined receipt status and from the policy ALLOW/ESCALATE/BLOCK decision.

**Basis:** technical/design assessment. **Sources:** [VIEM_SIM] [VIEM_RECEIPT] [RPC_CODE]

### C155: confirmed

A persisted signed raw transaction and derived hash close the dangerous accept-before-DB-update identity gap. Re-broadcasting identical bytes does not invent a second transaction or invoice.

**Basis:** technical/design assessment. **Sources:** [RPC_DOC] [EIP1559] [PG_CLIENT]

### C156: partially correct

Searches can help but are not guaranteed: pending mempools/provider APIs are incomplete and there is no general standard sender-plus-nonce lookup replacing a known hash. Persist the raw tx and hash before first broadcast.

**Basis:** technical/design assessment. **Sources:** [RPC_DOC] [RPC_CODE] [VIEM_RECEIPT_CODE]

### C157: confirmed

The documented action supports confirmations and same-nonce replacement detection. A process restart loses its local tracker; persist attempts, nonce family and block/receipt observations in PostgreSQL.

**Basis:** technical/design assessment. **Sources:** [VIEM_RECEIPT] [VIEM_RECEIPT_CODE] [PG_CLIENT]

### C158: confirmed

A service-generated fee-only replacement should retain signed execution identity and transaction nonce. Observe user replacements/cancellation rather than changing their payload; only canonical execution consumes invoice authority.

**Basis:** technical/design assessment. **Sources:** [EIP1559] [VIEM_RECEIPT] [VIEM_RECEIPT_CODE]

### C159: incorrect

A chosen confirmation depth is not consensus finality. Expose DEPTH_CONFIRMED separately from RPC_FINALIZED and LOCAL_DEMO, and never label a fallback threshold as a finalized checkpoint.

**Basis:** technical/design assessment. **Sources:** [ETH_FINALITY] [RPC_DOC] [VIEM_RECEIPT]

### C160: confirmed

The JSON-RPC reference defines safe and finalized tags, but actual support and meaning must be checked for the selected network/provider. No Robinhood finality behavior was established by a live RPC probe here.

**Basis:** technical/design assessment. **Sources:** [RPC_DOC] [EIP1898] [ETH_FINALITY] **Open items:** O06.

### C161: partially correct

Notify at a documented confidence threshold, but call the event payment.confirmed when only a depth policy was met. Reserve payment.finalized for the verified finalized-head meaning; local simulation must be labeled separately.

**Basis:** technical/design assessment. **Sources:** [RPC_DOC] [ETH_FINALITY]

### C162: confirmed

Durable range cursors, raw logs and ancestor checks are suitable recovery primitives. Apply projections and cursor advancement in one database transaction; websocket notifications can accelerate but not replace backfill.

**Basis:** technical/design assessment. **Sources:** [RPC_DOC] [RPC_CODE] [PG_CLIENT]

### C163: confirmed

Logs can be observed on different branches. Store deployment, blockHash and block-global logIndex; retain canonical/orphan status and do not treat transaction identity alone as proof of current inclusion.

**Basis:** technical/design assessment. **Sources:** [RPC_DOC] [RPC_CODE] [PG_CONSTRAINT]

### C164: confirmed

Replaying from a common ancestor repairs the database projection, not prior off-chain merchant actions. For a small demo dataset, rebuilding the deployment projection is a valid simpler implementation than generalized inverse events.

**Basis:** technical/design assessment. **Sources:** [RPC_DOC] [ETH_FINALITY] [PG_CLIENT]

### C165: confirmed

Consensus-finalized reversal has different assumptions and severity than a short unfinalized fork. An RPC conflict must not silently be interpreted as ordinary successful recovery.

**Basis:** technical/design assessment. **Sources:** [ETH_FINALITY] [RPC_DOC]

### C166: partially correct

Validation and bounded/adaptive reads are useful. Two providers agreeing does not cryptographically prove truth, and provider limits are service-specific. The pure local demo does not require a quorum/RPC fleet.

**Basis:** technical/design assessment. **Sources:** [RPC_DOC] [EIP1898] [RH_CONNECT]

### C167: confirmed

Reconciliation can compare contract state, actual event identity and receipt context independently of command processing. It must not synthesize successful chain events or mutate chain history to match the DB.

**Basis:** technical/design assessment. **Sources:** [RPC_CODE] [EIP20] [PG_CLIENT]

### C168: confirmed

An end-of-block balance difference need not isolate one payment when multiple transfers occur. Pinned supported-token transfer events and contract-measured deltas provide narrower evidence; traces require separate provider capability.

**Basis:** technical/design assessment. **Sources:** [EIP20] [RPC_DOC] [V4_MANAGER]

### C169: partially correct

Separate key powers are coherent, but the draft introduces more infrastructure than necessary. P0 needs owner, merchant and agent signing identities plus a gas-only relayer; optional issuer/guardian/KMS systems are not blockers.

**Basis:** technical/design assessment. **Sources:** [EIP712] [EIP2771] [EIP20]

### C170: partially correct

AWS documents secp256k1 keys and a signing API; Ethereum digest, DER-to-r/s, low-s and recovery conversion still require an integration test. P0 uses a scoped test-only signer, not an unverified KMS wrapper.

**Basis:** technical/design assessment. **Sources:** [KMS_SPEC] [KMS_SIGN] [OZ_CRYPTO] **Open items:** O08.

### C171: confirmed

A revocable address bound to a policy is workable. Revoking a web session does not revoke the on-chain agent, and rotating a gas-only relayer need not change the authorized agent identity.

**Basis:** technical/design assessment. **Sources:** [EIP712] [EIP2771] [SESSION]

### C172: confirmed

These are appropriate failure assumptions for independent SQL/RPC operations. Their engineering consequence is stable logical-payment identity and durable attempts, not pretending all remote effects are transactional.

**Basis:** technical/design assessment. **Sources:** [PG_CLIENT] [RPC_DOC] [VIEM_RECEIPT]

### C173: confirmed

The file contains the listed failure cases. They are proposed tests, not completed test evidence; promote only failures that affect the selected demo path into P0 gates.

**Basis:** draft failure matrix inspection. **Sources:** [FOUNDRY_TEST] [VIEM_RECEIPT]

### C174: confirmed

Direct recount finds eight rows marked Critical until: manifest compile, activation, quote, Aqua, hook identity, broadcast, reorg and reconciliation. This confirms the count, not resolution of the gaps.

**Basis:** direct count of supplied file lines 1223-1239. **Sources:** Supplied-draft inspection or an unavailable artifact, as stated in the finding; no external confirmation claimed.

### C175: confirmed

Preserve the same business identity across retries, distinguish deterministic rejection from mutable conditions, and reconcile uncertain broadcasts before creating any new execution attempt.

**Basis:** technical/design assessment. **Sources:** [VIEM_RECEIPT] [RPC_DOC] [BULL_IDEMP]

### C176: confirmed

An exact quote hash forbids altered quote bytes without fresh authority. A route-policy-bound design can re-estimate within fixed bounds; it must still resolve any possibly submitted older transaction first.

**Basis:** technical/design assessment. **Sources:** [EIP712] [AQUA_SDK] [VIEM_RECEIPT]

### C177: partially correct

Stable event identity and receiver deduplication are sound at-least-once design requirements. The custom webhook signing format is not yet implemented or independently tested; defer public webhooks and use polling for P0.

**Basis:** technical/design assessment. **Sources:** [BULL_IDEMP] [JWS] **Open items:** O09.

### C178: partially correct

The controls address identified attack surfaces but are not proofs against every threat. Exact slots leave residual authorized-spend exposure, immutable lists can reference mutable proxies, and typed signatures cannot prove a human saw the intended display.

**Basis:** technical/design assessment. **Sources:** [EIP712] [SOL_SECURITY] [OZ_SIG] [AQUA_AUDIT]

### C179: partially correct

On-chain checks can prevent a compromised DB from inventing authority, but the DB can still lie to the UI and a dishonest RPC can report false observations. Multiprovider agreement and rebuildability mitigate, not eliminate, this trust boundary.

**Basis:** technical/design assessment. **Sources:** [RPC_DOC] [EIP712] [PG_ISOLATION]

### C180: confirmed

The draft correctly warns against these unsupported product shortcuts. Resolve each with a concrete signer/state, economic equation, selected deployment or explicitly optional dependency.

**Basis:** technical/design assessment. **Sources:** [EIP140] [EIP7715] [V4_INTERFACE] [SWAPVM_CODE]

### C181: confirmed

Only the synchronous chain call tree participates in one EVM transaction. HTTP, signatures obtained earlier, database commits and later notifications remain separate operations.

**Basis:** technical/design assessment. **Sources:** [EIP140] [PG_CLIENT] [RPC_DOC]

### C182: partially correct

These are useful implementation checks, not completed evidence. Focus the demo gate on the chosen assets/routes and wallet path; gas-regression thresholds and governance tooling are not prerequisites to feasibility.

**Basis:** technical/design assessment. **Sources:** [FOUNDRY_TEST] [V4_DEPLOY] [SOL_SECURITY]

### C183: confirmed

Foundry provides unit/fuzz/invariant mechanisms and Anvil can control mining for race tests. The supplied notebook does not contain or show execution of these tests.

**Basis:** technical/design assessment. **Sources:** [FOUNDRY_TEST] [FOUNDRY_ANVIL]

### C184: confirmed

Testing actual pinned protocol implementations exposes integration mistakes that pure mocks miss. A local fork still depends on remote state not already cached; a fully seeded local deployment is a different reproducible option.

**Basis:** technical/design assessment. **Sources:** [FOUNDRY_ANVIL] [FOUNDRY_DEPLOY] [AQUA_ADDR] [V4_ADDRESSES]

### C185: partially correct

The listed tests are sensible acceptance criteria, but not all infrastructure is needed for the selected local demonstration. Include concurrency, revert rollback and broadcast/restart recovery; defer public webhook/quorum testing when those components are absent.

**Basis:** technical/design assessment. **Sources:** [PG_CLIENT] [VIEM_RECEIPT] [FOUNDRY_TEST]

### C186: unverifiable

ASCII comments can improve explanation but are not a technical correctness requirement. No retrieved protocol/tool specification makes these diagrams mandatory; keep them as an optional team convention.

**Basis:** documentation preference. **Sources:** Supplied-draft inspection or an unavailable artifact, as stated in the finding; no external confirmation claimed. **Open items:** O10.

### C187: partially correct

Balanced-tree proofs grow logarithmically, but activation can store more than one field and execution maintains consumption plus budget/nonce state. Do not equate one root with one total storage write.

**Basis:** technical/design assessment. **Sources:** [MERKLE_DOC] [MERKLE_CODE] [SOL_ABI]

### C188: incorrect

The exact per-payment gas comparison is unmeasured, and the proposed payment updates several counters/consumption/allowance states. It does not require exactly one storage write.

**Basis:** inspection of proposed execution sequence plus data-structure comparison. **Sources:** [SOL_SECURITY] [EIP20] [MERKLE_CODE]

### C189: confirmed

Bounded loops and compact typed fields avoid specified gas/encoding failure modes. Avoiding an oracle is valid only because P0 keeps output and input asset limits explicitly separate.

**Basis:** technical/design assessment. **Sources:** [SOL_SECURITY] [SOL_ABI] [EIP20]

### C190: partially correct

The access patterns justify candidate indexes, but indexing/partition thresholds require measurements. Cursor pagination is a chosen stable API contract; no partitioning is needed for the demo.

**Basis:** technical/design assessment. **Sources:** [PG_PARTIAL] [PG_CONSTRAINT] [PG_LOCK]

### C191: partially correct

These worker policies are coherent but their limits/lease rules need implementation. One worker and small fixed log ranges are an acceptable baseline; adaptive capacity and multiple queues are not mandatory.

**Basis:** technical/design assessment. **Sources:** [PG_LOCK] [PG_CLIENT] [BULL_IDEMP] [RH_CONNECT]

### C192: unverifiable

No workload, benchmark or measured provider limits establish this bottleneck ordering. Treat it as a hypothesis and do not let it dictate premature queue, sharding or account-abstraction work.

**Basis:** unmeasured performance prediction. **Sources:** Supplied-draft inspection or an unavailable artifact, as stated in the finding; no external confirmation claimed. **Open items:** O11.

### C193: unverifiable

The supplied notebook asserts a state of a local Mac directory, but that filesystem is not available here. No application source or deployment evidence was supplied in this conversation; that narrower statement is supportable.

**Basis:** unavailable private workspace. **Sources:** Supplied-draft inspection or an unavailable artifact, as stated in the finding; no external confirmation claimed. **Open items:** O12.

### C194: partially correct

These are reasonable maintainability/correctness conventions supported by explicit ABI/schema/transaction boundaries, not externally provable universal superiority claims. Use them where they clarify this build.

**Basis:** technical/design assessment. **Sources:** [SOL_ABI] [FASTIFY_SCHEMA] [PG_CLIENT]

### C195: confirmed

Check configured chain, deployed code, tokens and ABI before preparing a transaction. Address equality alone is not code identity; a published address table does not establish current target-chain runtime behavior.

**Basis:** technical/design assessment. **Sources:** [RPC_DOC] [AQUA_ADDR] [V4_ADDRESSES]

### C196: confirmed

Build artifacts can provide ABI/deployment records for shared bindings. Generate from the actual separately compiled source graphs and validate selectors; a handwritten adapter interface is not proof it matches deployed code.

**Basis:** technical/design assessment. **Sources:** [FOUNDRY_DEPLOY] [SOL_ABI] [SWAPVM_BUILD] [V4_BUILD]

### C197: partially correct

The gates can be implemented but were not executed here. No specific Slither version or integration is verified, so it is optional follow-up tooling, not a claimed available safety result or P0 dependency.

**Basis:** technical/design assessment. **Sources:** [FOUNDRY_TEST] [FOUNDRY_DEPLOY] **Open items:** O13.

### C198: confirmed

Correlate business ID, intent digest, tx hash, deployment and block hash while excluding credential material. Signed artifacts may be stored intentionally but should not be sprayed into routine logs.

**Basis:** technical/design assessment. **Sources:** [SESSION] [EIP712] [RPC_DOC]

### C199: partially correct

These are useful observability candidates, not necessary separate monitoring infrastructure. P0 exposes worker/RPC/configuration readiness and a timeline sufficient to diagnose failed or unknown demo payments.

**Basis:** technical/design assessment. **Sources:** [VIEM_RECEIPT] [RPC_DOC] [PG_LOCK]

### C200: confirmed

A reproducible seed and explicit deployment instance improve repeatability. Never relabel mocked RWA as issued stock, and never reuse stale successful projections after resetting a local chain.

**Basis:** technical/design assessment. **Sources:** [FOUNDRY_ANVIL] [FOUNDRY_DEPLOY] [RH_TOKENS]

### C201: incorrect

Freeze only provisional domain boundaries before dependency experiments. Compiler versions, actual ABI, hook context, receiver behavior and wallet capabilities can invalidate a prematurely fixed adapter schema.

**Basis:** technical/design assessment. **Sources:** [SWAPVM_BUILD] [V4_BUILD] [METAMASK_RPC] [AQUA_ADDR]

### C202: partially correct

Coordinating schemas, migrations and generated artifacts is a sensible process choice, not a protocol fact. No parallel staffing or timeline is assumed.

**Basis:** implementation coordination recommendation. **Sources:** [SOL_ABI] [PG_CONSTRAINT]

### C203: confirmed

The register labels proposed defaults and contains unresolved chain/product choices. Its entries are not evidence that any contract, wallet, API or deployment already works.

**Basis:** draft decision-register inspection. **Sources:** [AQUA_ADDR] [METAMASK_NET]

### C204: confirmed

Those questions are explicitly unresolved in the file. The rebuilt design chooses bounded demo defaults where possible and records remaining external uncertainties instead of silently accepting them.

**Basis:** draft question-register inspection. **Sources:** [AQUA_ADDR] [RH_TOKENS] [METAMASK_NET]

### C205: partially correct

These are valid candidate gates after selecting scope. Run a protocol/ABI/deployment spike before freezing interfaces, and do not require two protocol paths, full observability and public webhooks to prove the smaller core.

**Basis:** technical/design assessment. **Sources:** [FOUNDRY_DEPLOY] [SWAPVM_CODE] [V4_INTERFACE]

### C206: confirmed

Deferring these integrations is a deliberate technical-scope choice consistent with a single-chain atomic demo. It does not establish that any deferred integration is impossible.

**Basis:** technical/design assessment. **Sources:** [EIP140] [EIP4337] [EIP7715]

### C207: unverifiable

The historical claims about another machine/repository and what a prior model inspected cannot be independently established from the attachment. This review has the two supplied documents, not that workspace or prior execution logs.

**Basis:** unverified provenance. **Sources:** Supplied-draft inspection or an unavailable artifact, as stated in the finding; no external confirmation claimed. **Open items:** O12.

### C208: confirmed

The named mechanisms exist in retrieved docs/source. Reuse specific compatible releases; availability of a library is not a test of a new composition.

**Basis:** technical/design assessment. **Sources:** [OZ_SIG] [SWAPVM_CODE] [V4_MANAGER] [VIEM_RECEIPT] [PG_CLIENT] [BULL_IDEMP]

### C209: confirmed

No reusable SuzuPay API/schema/export/repository is attached here. This is an input-availability finding, not a statement that SuzuPay does not exist; use explicit synthetic fixtures until an interface is supplied.

**Basis:** supplied-material inspection. **Sources:** Supplied-draft inspection or an unavailable artifact, as stated in the finding; no external confirmation claimed. **Open items:** O14.

### C210: unverifiable

The review stages, Codex invocation and numerical score are historical self-reports without underlying execution logs. They cannot serve as independent evidence of engineering correctness.

**Basis:** unverified review provenance. **Sources:** Supplied-draft inspection or an unavailable artifact, as stated in the finding; no external confirmation claimed. **Open items:** O12.

### C211: partially correct

The references support many mechanisms, but several statements overreach or omit necessary constraints. The claim-by-claim results replace a blanket reliance on the bibliography; moving branches and cached docs can disagree.

**Basis:** technical/design assessment. **Sources:** [AQUA_ADDR] [SWAPVM_CODE] [PG_NUMERIC] [MERKLE_CODE]

### C212: confirmed

These checks remain necessary for the selected deployment. This session verified sources and version metadata but did not perform RPC bytecode probes, compile/deploy the project or test sponsor eligibility.

**Basis:** technical/design assessment. **Sources:** [AQUA_ADDR] [V4_ADDRESSES] [METAMASK_NET] **Open items:** O04, O05, O06, O13, O15.

### C213: unverifiable

The reported outside-voice run is not accompanied by its tool log; its duration judgment is excluded by the current request. Its written technical arguments are evaluated separately below.

**Basis:** unverified provenance and excluded timeline judgment. **Sources:** Supplied-draft inspection or an unavailable artifact, as stated in the finding; no external confirmation claimed. **Open items:** O01, O12.

### C214: confirmed

Exact preapproval of every business choice leaves only execution timing within that authorization. It is useful for planned payments but does not preserve the original promise of bounded autonomous merchant selection.

**Basis:** direct semantic comparison of product and manifest design. **Sources:** [EIP712]

### C215: confirmed

A digest does not disclose its preimage, and matching golden vectors only prove encoding agreement. A frontend can misrepresent either typed fields or leaf contents; readable review and independent recomputation are needed, not claims that metadataHash proves informed consent.

**Basis:** technical/design assessment. **Sources:** [EIP712] [MERKLE_CODE] [OZ_SIG]

### C216: partially correct

An exact expiring route commitment blocks changed route bytes without fresh authorization. Delayed execution is still possible within that quote lifetime, or with nonexpiring fixed-route constraints and bounded fresh estimates.

**Basis:** technical/design assessment. **Sources:** [AQUA_SDK] [EIP712] [V4_INTERFACE]

### C217: confirmed

This is a concrete draft defect: settlement-token caps cannot compare raw RWA input, and the proposed verifier must explicitly enforce output-token equality. Separate input and output accounting fixes both issues.

**Basis:** dimensional analysis and draft schema inspection. **Sources:** [EIP20] [SOL_ABI]

### C218: confirmed

The draft never specifies the approval override set. In the rebuilt design only the automatic per-payment threshold is bypassed, up to a hard escalation ceiling; total/day/input budgets and recipient/token/expiry remain mandatory.

**Basis:** internal invariant/acceptance-test contradiction. **Sources:** [EIP712] [SOL_SECURITY]

### C219: confirmed

The broadcaster of an agent-signed transaction is not the fee-paying sender. Use a relayer-owned outer transaction carrying a separately verified agent intent signature, or a fully specified AA/forwarder design.

**Basis:** technical/design assessment. **Sources:** [EIP1559] [EIP2771] [SOL_GLOBALS]

### C220: confirmed

The shared address holds pooled assets, and the numbered path omits the necessary owner-ledger update. A per-owner vault removes the internal share ledger; it does not remove the need for input/output budget accounting.

**Basis:** direct inspection of shared-custody sequence. **Sources:** [EIP20] [SOL_SECURITY]

### C221: confirmed

Fields without enforcement do not constrain order or exclusivity. A compromised agent can use all currently authorized capacity. State this residual exposure and add task/order rules only when they are part of the intended authority.

**Basis:** technical/design assessment. **Sources:** [EIP712] [SOL_SECURITY]

### C222: partially correct

The concern applies when the payer is an Aqua maker with persistent allowance. It is not an unavoidable incompatibility: make the payment adapter the taker and use a separate seeded maker, with finite payer-side/router allowances cleared afterward.

**Basis:** technical/design assessment. **Sources:** [AQUA_CODE] [SWAPVM_CODE] [AQUA_SDK]

### C223: confirmed

A payer rebate and LP compensation have different balance flows. Explicitly choose the subsidy asset, recipient and rounding. The rebuilt hook experiment donates settlement-token subsidy to LPs and does not call it an exact replacement of a counterfactual input-token fee.

**Basis:** technical/design assessment. **Sources:** [V4_INTERFACE] [V4_FEE] [EIP20]

### C224: confirmed

Verify actual source graphs and execution interfaces first. The retrieved exact compiler pragmas and deployment/version drift show why this can change the build rather than merely refine documentation.

**Basis:** technical/design assessment. **Sources:** [SWAPVM_BUILD] [V4_BUILD] [AQUA_ADDR] [METAMASK_RPC]

### C225: partially correct

The lower-dependency baseline is viable, but calling every other component a distraction is too broad. Retain the requested DB, API contracts and minimal durable transaction tracking because they directly support a full-stack restart-safe demo.

**Basis:** technical/design assessment. **Sources:** [PG_CLIENT] [VIEM_RECEIPT] [EIP20]

### C226: confirmed

The file explicitly preserves those tensions without adopting the corrections. Therefore the presence of the outside critique does not fix the contradictory structs, diagrams and invariants earlier in the document.

**Basis:** direct supplied-file inspection. **Sources:** Supplied-draft inspection or an unavailable artifact, as stated in the finding; no external confirmation claimed.

### C227: partially correct

Resolving those dependencies is necessary, but clarification alone is not runtime proof. The rebuilt chosen scope is buildable; clearance for a live integration comes from the executable acceptance tests and deployment checks, not another design verdict.

**Basis:** technical/design assessment. **Sources:** [FOUNDRY_TEST] [FOUNDRY_DEPLOY] [AQUA_ADDR]


<!-- Retrieved source links -->
[AQUA_ADDR]: https://business.1inch.com/portal/documentation/aqua/reference/verified-contract-addresses "Fresh verified-address reference"
[AQUA_AUDIT]: https://www.openzeppelin.com/news/1inch-aqua-and-swapvm-mvp-v1.0-audit "OpenZeppelin Aqua/SwapVM MVP audit"
[AQUA_CODE]: https://github.com/1inch/aqua/blob/main/src/Aqua.sol "Aqua registry implementation"
[AQUA_ROUTING]: https://business.1inch.com/portal/documentation/aqua/liquidity-layer/access-resolvers-and-pathfinder "Aqua access, resolvers and Pathfinder"
[AQUA_SDK]: https://business.1inch.com/portal/documentation/aqua/reference/sdk-overview "Aqua and SwapVM SDK overview"
[BULL_IDEMP]: https://docs.bullmq.io/patterns/idempotent-jobs "BullMQ idempotent jobs"
[BULL_REMOVE]: https://docs.bullmq.io/guide/queues/auto-removal-of-jobs "BullMQ auto-removal"
[CHAINLINK]: https://docs.chain.link/data-feeds/l2-sequencer-feeds "Chainlink sequencer-uptime feeds"
[CSRF]: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html "OWASP CSRF prevention"
[EIP1193]: https://eips.ethereum.org/EIPS/eip-1193 "Wallet provider API"
[EIP1271]: https://eips.ethereum.org/EIPS/eip-1271 "ERC-1271 contract signatures"
[EIP140]: https://eips.ethereum.org/EIPS/eip-140 "EIP-140 REVERT"
[EIP1559]: https://eips.ethereum.org/EIPS/eip-1559 "Transaction fee mechanics"
[EIP1898]: https://eips.ethereum.org/EIPS/eip-1898 "Block-hash RPC selectors"
[EIP20]: https://eips.ethereum.org/EIPS/eip-20 "ERC-20"
[EIP2771]: https://eips.ethereum.org/EIPS/eip-2771 "Native meta-transactions"
[EIP4337]: https://eips.ethereum.org/EIPS/eip-4337 "Account abstraction"
[EIP4361]: https://eips.ethereum.org/EIPS/eip-4361 "Sign-In with Ethereum"
[EIP712]: https://eips.ethereum.org/EIPS/eip-712 "EIP-712 typed structured data"
[EIP7715]: https://eips.ethereum.org/EIPS/eip-7715 "Request execution permissions"
[ENS_CODE]: https://github.com/ensdomains/ens-contracts/blob/master/contracts/resolvers/profiles/TextResolver.sol "ENS TextResolver source"
[ENS_DOC]: https://docs.ens.domains/resolvers/interfaces/ "ENS resolver interfaces"
[ETH_FINALITY]: https://ethereum.org/en/developers/docs/consensus-mechanisms/pos/ "Ethereum proof-of-stake finality"
[FASTIFY_SCHEMA]: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/ "Fastify validation/serialization"
[FOUNDRY_ANVIL]: https://getfoundry.sh/anvil/reference/ "Anvil reference"
[FOUNDRY_DEPLOY]: https://getfoundry.sh/forge/deploying/ "Foundry deployment scripts"
[FOUNDRY_TEST]: https://getfoundry.sh/forge/advanced-testing/invariant-testing/ "Foundry invariant testing"
[JCS]: https://www.rfc-editor.org/rfc/rfc8785 "RFC 8785 JSON canonicalization"
[JWS]: https://www.rfc-editor.org/rfc/rfc7515 "RFC 7515 signatures"
[KMS_SIGN]: https://docs.aws.amazon.com/kms/latest/APIReference/API_Sign.html "AWS KMS Sign API"
[KMS_SPEC]: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html "AWS KMS key specs"
[MERKLE_CODE]: https://github.com/OpenZeppelin/merkle-tree/blob/master/src/hashes.ts "OpenZeppelin Merkle hashing"
[MERKLE_DOC]: https://github.com/OpenZeppelin/merkle-tree "OpenZeppelin Merkle tree library"
[METAMASK_NET]: https://docs.metamask.io/smart-accounts-kit/get-started/supported-networks/ "MetaMask supported networks"
[METAMASK_RPC]: https://docs.metamask.io/smart-accounts-kit/reference/advanced-permissions/wallet-client "MetaMask wallet-client actions"
[NEXT_SELF]: https://nextjs.org/docs/app/guides/self-hosting "Next.js self-hosting"
[OZ_CRYPTO]: https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography "OpenZeppelin cryptography API"
[OZ_GUARD]: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.4.0/contracts/utils/ReentrancyGuard.sol "ReentrancyGuard v5.4.0"
[OZ_SAFE]: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.4.0/contracts/token/ERC20/utils/SafeERC20.sol "SafeERC20 v5.4.0"
[OZ_SIG]: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.4.0/contracts/utils/cryptography/SignatureChecker.sol "OpenZeppelin SignatureChecker v5.4.0"
[OZ_TOKEN_DOC]: https://docs.openzeppelin.com/contracts/5.x/api/token/erc20 "OpenZeppelin ERC-20 utilities"
[PG_CLIENT]: https://node-postgres.com/features/transactions "node-postgres transactions"
[PG_CONSTRAINT]: https://www.postgresql.org/docs/17/ddl-constraints.html "PostgreSQL 17 constraints"
[PG_ISOLATION]: https://www.postgresql.org/docs/17/transaction-iso.html "PostgreSQL 17 transaction isolation"
[PG_JSON]: https://www.postgresql.org/docs/17/datatype-json.html "PostgreSQL 17 JSON types"
[PG_LOCK]: https://www.postgresql.org/docs/17/sql-select.html "PostgreSQL 17 SELECT and locking"
[PG_NUMERIC]: https://www.postgresql.org/docs/17/datatype-numeric.html "PostgreSQL 17 exact numeric"
[PG_PARTIAL]: https://www.postgresql.org/docs/17/indexes-partial.html "PostgreSQL partial indexes"
[PG_TYPES]: https://node-postgres.com/features/types "node-postgres type parsing"
[PRISMA_TYPES]: https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types "Prisma special fields/types"
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
[V4_ADDRESSES]: https://developers.uniswap.org/docs/protocols/v4/deployments "Uniswap deployment reference"
[V4_BUILD]: https://github.com/Uniswap/v4-core/blob/main/foundry.toml "Uniswap v4 core build configuration"
[V4_DEPLOY]: https://developers.uniswap.org/docs/protocols/v4/guides/hooks/hook-deployment "Uniswap hook deployment"
[V4_FEE]: https://github.com/Uniswap/v4-core/blob/main/src/libraries/LPFeeLibrary.sol "Uniswap v4 LPFeeLibrary"
[V4_HOOK_INTERFACE]: https://github.com/Uniswap/v4-core/blob/main/src/interfaces/IHooks.sol "Uniswap v4 IHooks"
[V4_IDENTITY]: https://developers.uniswap.org/docs/protocols/v4/guides/hooks/accessing-msg.sender "Original sender inside hooks"
[V4_INTERFACE]: https://github.com/Uniswap/v4-core/blob/main/src/interfaces/IPoolManager.sol "Uniswap v4 IPoolManager"
[V4_MANAGER]: https://github.com/Uniswap/v4-core/blob/main/src/PoolManager.sol "Uniswap v4 PoolManager source"
[V4_POOL]: https://github.com/Uniswap/v4-core/blob/main/src/libraries/Pool.sol "Uniswap v4 pool implementation"
[VERCEL_LIMIT]: https://vercel.com/docs/functions/limitations "Vercel function limits"
[VIEM_RECEIPT]: https://viem.sh/docs/actions/public/waitForTransactionReceipt "viem receipt/replacement action"
[VIEM_RECEIPT_CODE]: https://github.com/wevm/viem/blob/main/src/actions/public/waitForTransactionReceipt.ts "viem receipt implementation"
[VIEM_SIM]: https://viem.sh/docs/contract/simulateContract "viem contract simulation"
[VIEM_SIM_CODE]: https://github.com/wevm/viem/blob/viem%402.56.3/src/actions/public/simulateContract.ts "viem 2.56.3 simulation implementation"
[VIEM_SIWE]: https://viem.sh/docs/siwe/actions/verifySiweMessage "viem SIWE verification"
[VIEM_SIWE_CODE]: https://github.com/wevm/viem/blob/main/src/actions/siwe/verifySiweMessage.ts "viem SIWE source"
