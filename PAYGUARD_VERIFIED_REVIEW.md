# PayGuard: independently researched technical review and rebuilt architecture

**Review date: September 12, 2026. Scope: a working full-stack hackathon proof-of-concept, with no timeline estimate.**

The supplied ENGINEERING_ANALYSIS.md is treated as an unverified proposal, including its outside-voice section. The original PayGuard product plan is a separate statement of intended behavior. The two are not silently reconciled. [DRAFT] [PRODUCT]

The numbered register comes before the verdicts. Identical repeated assertions are consolidated; distinct alternatives, interfaces, invariants and outside-voice objections remain represented. Each item points to the draft's line range. A requirement or recommendation is distinguished from an already implemented capability. Source-derived behavior, mathematical/design inference and unverified runtime behavior are identified separately.

Research used live web retrieval, fresh Firecrawl scrapes, Context7 documentation queries and Exa retrieval of primary documentation/source code. Important chain/security/API/deployment mechanisms are cross-checked across a specification or official guide and an implementation/release record. Two retrieval tools showing the same page are not treated as two independent sources. The external audit is additional evidence for its stated commits, not an audit of PayGuard.

The new HTTP paths, schema and contract interfaces are **proposed application specifications**, not pre-existing endpoints or tested code. Their dependencies have source evidence; their implementation acceptance remains O13/O16/O17. The source register states where a page reports deployment checks rather than this review performing those checks.

**Companion implementation contracts:** [HTTP/auth/data shapes](API_CONTRACT.md), [proposed database schema](DATABASE_SCHEMA.sql), [proposed Solidity interface](CONTRACT_INTERFACE.sol), [machine-readable claim ledger](CLAIMS_VERIFIED.json), [source register](sources.json). These files are part of this review; none is represented as a running application.

## 1. Claims extracted

The following 227 distinct claim records are lightly paraphrased from the supplied draft. They include technical assertions, proposed defaults and claims of prior work; numbering is stable across the verification ledger. Repeated copies in decision/TODO tables point back to the same substantive assertion.

### Scope

1. **C001.** Authorization, asset conversion, and fee sponsorship are distinct systems that the product combines. *Draft L10-L20.* [DRAFT]

2. **C002.** A protocol-independent authorization kernel can atomically consume human-approved spending authority and call a bounded settlement adapter. *Draft L18-L22.* [DRAFT]

3. **C003.** The core authorization proof can operate without Aqua, Uniswap, ERC-7715, World ID, ENS, or an RWA token. *Draft L20.* [DRAFT]

4. **C004.** Exact one-use signed slots prevent an agent from enlarging recipient, amount, asset, invoice, route, or validity authority. *Draft L22.* [DRAFT]

5. **C005.** The proposed complete architecture is a suitable one-month implementation target. *Draft L24-L32.* [DRAFT]

6. **C006.** A non-upgradeable vault, direct-transfer reference path, and optional protocol integrations are the recommended decomposition. *Draft L26-L30.* [DRAFT]

### Backend

7. **C007.** A TypeScript modular API, PostgreSQL transactional outbox, worker/indexer, and viem can implement the control plane. *Draft L31-L33.* [DRAFT]

### Auth

8. **C008.** The human key remains in the wallet; session/relayer keys do not need human fund-control authority. *Draft L32-L33.* [DRAFT]

### State

9. **C009.** Canonical chain state owns payments and consumption; PostgreSQL owns drafts, idempotency, orchestration, and projections. *Draft L33-L45.* [DRAFT]

### Security

10. **C010.** Every successful settlement must deliver only to the approved recipient. *Draft L37.* [DRAFT]

11. **C011.** A one-use slot cannot be consumed twice, including concurrent transactions and retries. *Draft L38.* [DRAFT]

12. **C012.** The adapter must spend at most maxInputAmount and deliver at least the required output. *Draft L39.* [DRAFT]

### Evm

13. **C013.** A settlement failure must leave slot consumption and PayGuard accounting unchanged. *Draft L40.* [DRAFT]

### Security

14. **C014.** Only the human authorization path can increase authority; exception approval must bind an exact intent. *Draft L41-L43.* [DRAFT]

15. **C015.** Expired, revoked, superseded, wrong-chain, and wrong-vault authorizations must fail. *Draft L42.* [DRAFT]

### Tokens

16. **C016.** A successful payment must leave no reusable allowance to an untrusted adapter. *Draft L44.* [DRAFT]

### State

17. **C017.** Canonical events plus immutable signed artifacts can rebuild projections, and external retries must be idempotent. *Draft L45-L46.* [DRAFT]

### Security

18. **C018.** A generic budget does not prevent prompt injection when agent-controlled information determines merchant/category approval. *Draft L54.* [DRAFT]

19. **C019.** A category policy is insufficient unless credentials are trusted and immutable and the merchant set is bounded. *Draft L81.* [DRAFT]

### Scope

20. **C020.** Exact manifests plus aggregate caps are stronger than either generic policy or exact manifests alone. *Draft L85-L89.* [DRAFT]

21. **C021.** An independent kernel with replaceable adapters is technically preferable to a single coupled integration path. *Draft L95-L99.* [DRAFT]

### Evm

22. **C022.** Reverting a transaction removes its logs; a view function cannot persist an audit event. *Draft L103.* [DRAFT]

### State

23. **C023.** Off-chain signed attempt records can represent denied requests without claiming a reverted event exists on-chain. *Draft L105-L109.* [DRAFT]

24. **C024.** Non-reverting attempt calls and separate recordAttempt calls can preserve denial logs, with different receipt and spam semantics. *Draft L106-L107.* [DRAFT]

### Budget

25. **C025.** Budget denomination and day boundaries must be explicit; single-settlement-token fixed UTC epochs avoid an authorization-price oracle. *Draft L115-L125.* [DRAFT]

26. **C026.** A chain reorganization must undo orphaned spend accounting; approval reservations need separate semantics. *Draft L118-L119.* [DRAFT]

### Oracle

27. **C027.** Oracle-valued multi-asset budgets add freshness, decimals, sequencer, deviation, and availability failure modes. *Draft L121-L123.* [DRAFT]

### Security

28. **C028.** Several individually allowed payments can consume a budget; exact recipient/invoice/domain binding detects substitutions and duplicates. *Draft L129-L138.* [DRAFT]

### Scope

29. **C029.** Replacing generic spending policy with exact preapproved manifests reduces scope structurally, not functionally. *Draft L142.* [DRAFT]

### Auth

30. **C030.** Owners, agents, merchants, relayers, issuers, adapters, RPC providers, and protocol contracts require distinct authority boundaries. *Draft L150-L160.* [DRAFT]

### State

31. **C031.** Wallet authorization requires signature/on-chain activation evidence; a websocket notification alone does not prove finality. *Draft L166-L175.* [DRAFT]

### Queue

32. **C032.** An outbox row is durable delivery authority until acknowledged; a Redis job is secondary. *Draft L173.* [DRAFT]

### Backend

33. **C033.** Next.js-only serverless hosting fits long-lived indexing, nonce serialization, and retries poorly; a dedicated worker avoids these constraints. *Draft L211-L214.* [DRAFT]

34. **C034.** Next.js plus worker and Fastify plus worker are viable alternatives; microservices are unnecessary for the proposed demo. *Draft L211-L214.* [DRAFT]

35. **C035.** A monorepo can share domain, DB, chain, ABI, agent SDK, and test fixtures across API, worker, and future web clients. *Draft L219-L229.* [DRAFT]

### Queue

36. **C036.** Redis/BullMQ is optional; PostgreSQL can remain the sole durable queue store without Kafka. *Draft L232.* [DRAFT]

### Merkle

37. **C037.** On-chain slots trade activation/storage cost for simpler verification; a Merkle root trades proof complexity for compact activation. *Draft L244-L246.* [DRAFT]

### Auth

38. **C038.** Human signatures on every payment remove unattended execution unless obtained in advance. *Draft L246.* [DRAFT]

### Merkle

39. **C039.** The proposed ManifestHeader binds owner, vault, agent, chain, version, validity, settlement token, total budget, slotsRoot, and optional metadataHash. *Draft L250-L263.* [DRAFT]

40. **C040.** The proposed SpendSlot binds identity, recipient, credential, tokens, output amount, input ceiling, adapter, quote/invoice hashes, validity, and one use. *Draft L268-L284.* [DRAFT]

### Tokens

41. **C041.** The zero address can represent an explicitly wildcarded input asset. *Draft L276.* [DRAFT]

### Merkle

42. **C042.** The leaf formula includes SLOT_TYPEHASH and manifestId as well as every slot field. *Draft L287-L309.* [DRAFT]

### Testing

43. **C043.** Shared Solidity/TypeScript golden vectors can verify canonical hashing and proof agreement. *Draft L287.* [DRAFT]

### Crypto

44. **C044.** abi.encodePacked with heterogeneous dynamic inputs can be ambiguous; hash dynamic fields before structured encoding. *Draft L312.* [DRAFT]

### State

45. **C045.** Manifests have immutable versions and explicit activation, revocation, replacement, expiry, and derived exhaustion. *Draft L316-L340.* [DRAFT]

### Auth

46. **C046.** A higher version does not revoke older versions unless replacement or a minimum-valid-version rule explicitly does so. *Draft L337.* [DRAFT]

47. **C047.** Revocation affects future execution, validity can use block.timestamp < validUntil, and authority is scoped to chain/vault/owner/agent. *Draft L338-L340.* [DRAFT]

### State

48. **C048.** Intent lifecycle distinguishes schema/auth/policy rejection, approval, submission uncertainty, inclusion, revert, reorg, finality, and reconciliation. *Draft L344-L366.* [DRAFT]

### Db

49. **C049.** SQL compare-and-set updates on status and state_version protect concurrent state transitions. *Draft L369-L377.* [DRAFT]

### Auth

50. **C050.** ExceptionApproval binds manifestId, slotId, intentHash, approver, nonce, and expiry. *Draft L381-L391.* [DRAFT]

### Budget

51. **C051.** Approval without reservation is viable, but execution must recheck balance and budget and may fail after approval. *Draft L396-L400.* [DRAFT]

52. **C052.** On-chain reservation adds expiry/accounting states; off-chain reservations cannot guarantee on-chain capacity. *Draft L397-L398.* [DRAFT]

### Custody

53. **C053.** A deposited-token vault is a viable bounded-execution model; smart-account modules and ERC-7715 have additional compatibility requirements. *Draft L410-L413.* [DRAFT]

54. **C054.** An EOA's ERC-20 allowance to a router cannot safely express complete policy and should be rejected. *Draft L413.* [DRAFT]

55. **C055.** The proposed shared contract with balances[owner][token] is not an omnibus pool. *Draft L415.* [DRAFT]

56. **C056.** Shared custody is cheaper to deploy/easier to index, while per-owner vaults reduce the blast radius. *Draft L415.* [DRAFT]

### Contract

57. **C057.** The vault must own custody, authorization, replay protection, budget consumption, bounded adapter calls, and settlement verification. *Draft L420-L426.* [DRAFT]

58. **C058.** Direct, Aqua, and v4 adapters, a merchant subsidy hook, and an optional registry can have separate responsibilities. *Draft L428-L450.* [DRAFT]

59. **C059.** Integrating the authorization registry into the vault avoids an additional contract boundary without changing atomicity. *Draft L455-L459.* [DRAFT]

60. **C060.** activateManifest(header, ownerSignature, mode) can accept relayed activation and return a manifest ID. *Draft L470-L474.* [DRAFT]

61. **C061.** deposit(token, amount, beneficiary) and owner withdraw(token, amount, recipient) form the custody API. *Draft L467-L468.* [DRAFT]

62. **C062.** revokeManifest and revokeAgent require owner-scoped revocation semantics. *Draft L476-L477.* [DRAFT]

63. **C063.** evaluate is view-only, while executePayment accepts payment, slot proof, exception data, and adapterData and returns a payment ID and input spent. *Draft L479-L491.* [DRAFT]

64. **C064.** A settle(request, adapterData) adapter may return reported input/output amounts. *Draft L495-L498.* [DRAFT]

65. **C065.** adapterData must exactly hash to slot.quoteHash and decode a fixed schema rather than arbitrary targets/calldata. *Draft L502.* [DRAFT]

### Auth

66. **C066.** Execution authenticates msg.sender as the agent or an authorized delegation redeemer. *Draft L507.* [DRAFT]

### Contract

67. **C067.** Execution verifies active domain, Merkle proof, immutable payment fields, unused slot, aggregate/period limits, and applicable exception approval. *Draft L508-L513.* [DRAFT]

68. **C068.** Snapshots, pre-call consumption/counter writes, bounded approvals, adapter execution, approval clearing, and postconditions can occur atomically. *Draft L514-L522.* [DRAFT]

### Security

69. **C069.** Checks-effects-interactions and a non-reentrancy guard are both required for this external-call execution design. *Draft L525.* [DRAFT]

### Custody

70. **C070.** Actual ERC-20 contract balances alone cannot identify different owners' shares of a shared vault. *Draft L531-L533.* [DRAFT]

71. **C071.** A correct shared ledger equals deposits minus settlement inputs and withdrawals, with actual balance covering all owner ledgers. *Draft L538-L539.* [DRAFT]

### Tokens

72. **C072.** Plain-token exact-delta accounting does not automatically support fee-on-transfer, rebasing, or callback-bearing assets. *Draft L542.* [DRAFT]

### Audit

73. **C073.** An OpenZeppelin Aqua/SwapVM audit identifies token-semantics assumptions as an accounting boundary. *Draft L542.* [DRAFT]

### Tokens

74. **C074.** Deposit credit should use received balance delta; adapter reports must be checked against observed deltas. *Draft L544.* [DRAFT]

### Auth

75. **C075.** Owner withdrawals and revocations should remain possible while payment execution is paused. *Draft L550-L558.* [DRAFT]

76. **C076.** Adapter additions, pauses, merchant credentials, upgrades, and exception signers require separate controls. *Draft L552-L558.* [DRAFT]

77. **C077.** Constructor-pinned adapters prevent a hot backend administrator from inserting a new spend path. *Draft L560.* [DRAFT]

### Events

78. **C078.** The specified activation, revocation, execution, approval, and pause events provide correlation data for indexing. *Draft L564-L570.* [DRAFT]

79. **C079.** Logs are not contract storage and should not serve as an authorization database. *Draft L573.* [DRAFT]

80. **C080.** Custom errors provide stable machine-readable failure identities for backend mapping. *Draft L575-L581.* [DRAFT]

### Crypto

81. **C081.** EIP-712 domain separation can bind name, version, chainId, and verifyingContract. *Draft L586-L593.* [DRAFT]

82. **C082.** EIP-1271 enables contract-wallet signature verification, while ECDSA helpers reject non-canonical high-s signatures. *Draft L593.* [DRAFT]

83. **C083.** Domain separation, manifest version/root, slot consumption, approval nonces, and agent binding address different replay surfaces. *Draft L595-L601.* [DRAFT]

### Testing

84. **C084.** Stateful invariants can test single consumption, correct recipient, counter rollback, ledger ownership, replay, and settlement bounds. *Draft L605-L615.* [DRAFT]

### Budget

85. **C085.** Summing inputSpent for a manifest is a valid invariant against its settlement-token totalBudget. *Draft L607.* [DRAFT]

### Erc7715

86. **C086.** ERC-7715 defines permission-request JSON-RPC with optional adjustments, permission context, dependencies, and delegation-manager information. *Draft L623.* [DRAFT]

87. **C087.** Wallet capability detection and inspection of actually granted permissions are required before relying on ERC-7715. *Draft L627.* [DRAFT]

88. **C088.** Session recipient/context and undeployed dependencies affect redemption; wallet and PayGuard revocation are distinct unless coupled. *Draft L628-L631.* [DRAFT]

89. **C089.** Native on-chain session authorization can preserve the core product when ERC-7715 is unavailable. *Draft L635-L639.* [DRAFT]

### Aqua

90. **C090.** Aqua keeps tokens in maker wallets and tracks virtual balances/allowances; ship/dock manage immutable strategy identities. *Draft L643.* [DRAFT]

91. **C091.** SwapVM always executes signed bytecode programs sequentially, with instruction order security-critical. *Draft L643.* [DRAFT]

92. **C092.** Custom-opcode settlement is a larger trusted surface than calling a bounded stock SwapVM adapter. *Draft L645-L654.* [DRAFT]

93. **C093.** PayGuard can call a stock SwapVM router through a fixed-program adapter; unrestricted aggregator calldata is not equivalent. *Draft L652-L654.* [DRAFT]

94. **C094.** Aqua integration must bind deployment, program/instruction set, maker, token pair, receiver, deadline, maximum input, and compatible traits. *Draft L658-L662.* [DRAFT]

95. **C095.** A domain-specific unique salt is needed to bind a strategy to chain, vault, manifest, slot, token pair, and program version. *Draft L661.* [DRAFT]

96. **C096.** Identical program bytes and an atomic vault-forward path can support bounded receiver settlement, subject to protocol behavior. *Draft L663-L664.* [DRAFT]

### Audit

97. **C097.** The Aqua/SwapVM MVP audit found token binding, quote/swap, external logic, push/accounting, ordering, fee, and receiver-trait problems. *Draft L667.* [DRAFT]

### Aqua

98. **C098.** Only a kernel-owned authorization state avoids duplicate consumption; an opcode can mirror a read-only decision. *Draft L671-L675.* [DRAFT]

### V4

99. **C099.** Uniswap v4 hook permissions are encoded in the deployed address; real deployment requires suitable CREATE2 mining. *Draft L683.* [DRAFT]

100. **C100.** Per-swap LP fee overrides require a dynamic-fee pool, override flag, and valid fee bounds. *Draft L684.* [DRAFT]

101. **C101.** A hook's msg.sender is PoolManager and its sender argument usually identifies the router, not the original payer. *Draft L685.* [DRAFT]

102. **C102.** All v4 currency deltas must be settled before the unlock operation completes. *Draft L686.* [DRAFT]

103. **C103.** Hooks can be attached to other pools unless they restrict acceptable pool keys/initialization. *Draft L687.* [DRAFT]

104. **C104.** Zeroing the payer's LP fee and debiting a subsidy balance do not themselves compensate liquidity providers. *Draft L693-L698.* [DRAFT]

105. **C105.** Hook-return custom accounting can adjust swap deltas but requires correct signs and exact-input/output handling. *Draft L694.* [DRAFT]

### Subsidy

106. **C106.** Normal pool fees plus a capped merchant-funded rebate are a technically simpler alternative, but not identical to merchant-paid LP fees. *Draft L695-L708.* [DRAFT]

107. **C107.** Sponsoring transaction gas is distinct from sponsoring liquidity fees. *Draft L696.* [DRAFT]

108. **C108.** A rebate must be computed from defined observed amounts, capped, prefunded, and tested using per-party token deltas. *Draft L702-L706.* [DRAFT]

109. **C109.** Subsidy exhaustion may revert or use an explicitly authorized full/partial fallback; economics cannot silently change after approval. *Draft L712-L716.* [DRAFT]

110. **C110.** The slot schema encodes subsidyRequired versus subsidyBestEffort. *Draft L716.* [DRAFT]

### Merchant

111. **C111.** Self-declared category strings are not trusted credentials; exact recipients and issuer-signed claims are viable alternatives. *Draft L720-L732.* [DRAFT]

112. **C112.** Backend JSON and ENS text records can change and should not be sole immutable authorization evidence. *Draft L727-L730.* [DRAFT]

113. **C113.** Exact recipient authorization can work even when live registry/ENS access is unavailable. *Draft L732.* [DRAFT]

### Oracle

114. **C114.** A single settlement-token budget needs no USD oracle; optional oracle integrations need feed/decimal/freshness and sequencer rules. *Draft L736-L742.* [DRAFT]

### Backend

115. **C115.** Identity, manifests, invoices, intents, simulation, transaction tracking, indexing, reconciliation, and notifications have distinct control-plane responsibilities. *Draft L750-L760.* [DRAFT]

### Api

116. **C116.** Idempotent commands return their original result for the same request and reject same-key/different-request reuse with 409. *Draft L764-L767.* [DRAFT]

117. **C117.** uint256 API amounts must not be transported as JavaScript numbers; use validated atomic-unit decimal strings. *Draft L768.* [DRAFT]

118. **C118.** Addresses require canonical validation/storage; chain-scoped commands and responses must expose chain and observation context. *Draft L769-L771.* [DRAFT]

119. **C119.** The proposed identity API covers SIWE challenges/verification, agent creation/revocation, and wallet-capability lookup. *Draft L777-L782.* [DRAFT]

### Auth

120. **C120.** Creating an agent API record alone does not establish on-chain authority. *Draft L785.* [DRAFT]

### Api

121. **C121.** The proposed manifest API supports drafts, compile, signatures, activation/revocation transactions, inspection, and proof lookup. *Draft L790-L797.* [DRAFT]

122. **C122.** Compiled manifest artifacts must be immutable/content-addressed; draft edits create a new signed version. *Draft L800.* [DRAFT]

123. **C123.** The proposed payment API supports invoice verification, idempotent creation, simulation, approval signing, execution preparation/broadcast, status, and timeline. *Draft L805-L813.* [DRAFT]

124. **C124.** A public arbitrary PATCH status endpoint would bypass the intended state-transition authority. *Draft L816.* [DRAFT]

125. **C125.** Transaction lookup, webhooks, reconciliation, and liveness/readiness endpoints need appropriate separate access rules. *Draft L821-L828.* [DRAFT]

### Db

126. **C126.** Idempotency records need principal/operation/key uniqueness, request hashes, progress/response records, and recovery leases. *Draft L830-L844.* [DRAFT]

127. **C127.** Domain creation and idempotency creation can share one transaction; uniqueness conflicts and leases must not create duplicate resources. *Draft L849-L856.* [DRAFT]

128. **C128.** The proposed relational schema covers users/wallets, challenges/sessions, agents, merchants/credentials/invoices, manifests/slots, intents, and approvals. *Draft L863-L880.* [DRAFT]

129. **C129.** The proposed operational schema covers transaction attempts, canonical/orphan blocks/events, cursors, outbox, webhook deliveries, and reconciliation. *Draft L882-L893.* [DRAFT]

130. **C130.** Transaction/log/manifest/approval uniqueness, partial pending indexes, and validity/amount constraints support consistency. *Draft L898-L905.* [DRAFT]

131. **C131.** UNIQUE(chain_id,sender,nonce,tx_hash) plus application logic enforces one canonical winner per sender/nonce. *Draft L900.* [DRAFT]

132. **C132.** PostgreSQL numeric(78,0) or a validated decimal string can store uint256 without floating-point loss. *Draft L907.* [DRAFT]

133. **C133.** Prisma Decimal values must not be converted through floating-point JSON numbers. *Draft L907.* [DRAFT]

134. **C134.** Canonical JSON plus normalized security-critical fields preserves signed evidence and enables constraints/indexed queries. *Draft L909-L915.* [DRAFT]

### Siwe

135. **C135.** SIWE requires server challenges, single-use nonce, domain/URI/chain/time validation, and secure session handling. *Draft L921-L925.* [DRAFT]

136. **C136.** HttpOnly/Secure/SameSite cookies and CSRF protection are suitable for human browser-session mutations. *Draft L924-L925.* [DRAFT]

### Auth

137. **C137.** API keys, challenge-issued short-lived tokens, and EIP-712 envelopes have different authentication properties. *Draft L931-L935.* [DRAFT]

138. **C138.** A signed agent HTTP envelope can bind method, path, body hash, time, nonce, chain, and audience but is separate from fund authority. *Draft L935.* [DRAFT]

### Merchant

139. **C139.** Merchant invoices can use EIP-712 or mapped JWS credentials with deterministic, versioned canonicalization. *Draft L939-L941.* [DRAFT]

140. **C140.** Invoice expiry and a unique invoice ID prevent invoice replay. *Draft L942.* [DRAFT]

### Queue

141. **C141.** Workers can separate outbox dispatch, broadcasting, tracking, log scanning, ancestry/finality checks, reconciliation, webhooks, and expiry. *Draft L948-L956.* [DRAFT]

142. **C142.** A transactional outbox and FOR UPDATE SKIP LOCKED with durable leases support recoverable at-least-once processing. *Draft L960-L965.* [DRAFT]

143. **C143.** BullMQ deterministic job IDs help deduplication but cease protecting removed jobs; handlers still need durable idempotency. *Draft L962-L967.* [DRAFT]

144. **C144.** Retryable jobs can use bounded exponential backoff/jitter; terminal failures and exhausted retries need distinct states. *Draft L964-L965.* [DRAFT]

### Db

145. **C145.** The proposed database has a UNIQUE(manifest_version,slot) payment-intent winner that prevents multiple attempts for one slot. *Draft L973-L981.* [DRAFT]

### Evm

146. **C146.** Preflight simulation is not a lock and execution must recheck mutable state. *Draft L984.* [DRAFT]

### Relay

147. **C147.** A relayer's EOA nonce allocation can be serialized with SQL row/advisory locking and persisted signed transactions. *Draft L988-L990.* [DRAFT]

148. **C148.** ERC-4337/UserOperations or per-agent signers are preferable to a single global relayer nonce bottleneck. *Draft L991.* [DRAFT]

### Db

149. **C149.** Optimistic draftVersion updates prevent lost edits, while compiled/signed versions remain immutable. *Draft L995.* [DRAFT]

### Auth

150. **C150.** Approval nonce/hash uniqueness and explicit on-chain cancellation/revocation constrain competing approvals. *Draft L999.* [DRAFT]

### Api

151. **C151.** Stable domain error codes with retryable/requestId/details fields can hide provider-specific text. *Draft L1003-L1014.* [DRAFT]

### Rpc

152. **C152.** A broadcast timeout means unknown chain status, not proof that payment failed. *Draft L1017.* [DRAFT]

153. **C153.** Simulation should record a pinned block, exact calldata/hash, relevant state, and gas-estimate context before signing. *Draft L1025-L1030.* [DRAFT]

154. **C154.** Failures can be terminal-policy, mutable-capacity, market/expiry, or infrastructure-unknown. *Draft L1034-L1037.* [DRAFT]

### Relay

155. **C155.** Persisting signed transaction identity before broadcasting permits same-raw-transaction recovery after an accept-then-timeout crash. *Draft L1041-L1049.* [DRAFT]

156. **C156.** Sender/nonce, recent-block searches, and provider-specific mempool APIs can help recover an unknown transaction where those records are available. *Draft L1049.* [DRAFT]

### Viem

157. **C157.** Viem waitForTransactionReceipt supports confirmation counts and same-nonce replacement detection, but not durable restart state. *Draft L1055-L1062.* [DRAFT]

### Relay

158. **C158.** Backend repricing should keep destination/value/calldata/nonce unchanged; user replacements should be observed, not silently overwritten. *Draft L1066-L1068.* [DRAFT]

### Finality

159. **C159.** Included/confirming/finalized are distinct; finalized can mean an RPC-finalized head or a configured confirmation-depth fallback. *Draft L1074-L1081.* [DRAFT]

### Rpc

160. **C160.** Ethereum JSON-RPC defines safe/finalized tags; support and L2 finality policy must be discovered/configured per network/provider. *Draft L1081-L1089.* [DRAFT]

### Finality

161. **C161.** Merchant finalized notifications should follow the explicitly configured settlement confidence policy rather than first inclusion. *Draft L1092.* [DRAFT]

### Indexer

162. **C162.** Bounded getLogs polling, block ancestry, idempotent raw logs/projections, and transactional cursors enable replayable indexing. *Draft L1094-L1119.* [DRAFT]

163. **C163.** Event identity should include chain/block hash/log index and retain orphaned events, not only transaction hash. *Draft L1122.* [DRAFT]

164. **C164.** A detected reorg requires ancestor recovery, orphan marking, projection replay, revised status, and no silent external-action reversal. *Draft L1126-L1135.* [DRAFT]

### Finality

165. **C165.** A change to a truly finalized block is not an ordinary short reorg. *Draft L1135.* [DRAFT]

### Rpc

166. **C166.** RPC fallback requires chain/block validation, adaptive getLogs limits, and selective caching rather than blind fastest-provider selection. *Draft L1139-L1144.* [DRAFT]

### Indexer

167. **C167.** Reconciliation separately compares receipt, event, consumption, asset/amount/adapter bounds, and DB links, without editing chain history. *Draft L1148-L1172.* [DRAFT]

### Tokens

168. **C168.** Transaction-level balance attribution is difficult with arbitrary ERC-20 transfers/multicalls; observed contract events and traces can aid reconciliation. *Draft L1163.* [DRAFT]

### Keys

169. **C169.** Owner, agent, relayer, invoice, issuer, guardian, and deployer keys should have different limited authorities. *Draft L1182-L1188.* [DRAFT]

170. **C170.** Local keys, cloud secp256k1 KMS signing, and smart-account session modules have different custody/encoding/compatibility requirements. *Draft L1192-L1194.* [DRAFT]

171. **C171.** A revocable agent EOA can be viable; agent, API session, and relayer rotation must not be conflated. *Draft L1196-L1204.* [DRAFT]

### Reliability

172. **C172.** Remote calls may succeed before timeout, workers may repeat, events may reorder/orphan, and uncertainty must not create a new payment. *Draft L1212-L1217.* [DRAFT]

### Testing

173. **C173.** The failure matrix covers encoding, activation, concurrency, approvals, routes, protocols, subsidy, tokens, relay recovery, replacement, indexing, reorg, finality, webhooks, reconciliation, and withdrawal. *Draft L1223-L1239.* [DRAFT]

### Scope

174. **C174.** The failure matrix contains exactly eight critical pre-implementation gaps. *Draft L1241.* [DRAFT]

### Reliability

175. **C175.** Retries must distinguish same-operation recovery, re-simulation, terminal policy/configuration, and unknown transaction state. *Draft L1245-L1251.* [DRAFT]

### Quotes

176. **C176.** Expired routes can be re-quoted into a new execution attempt only when the signed slot permits the change and prior submission is resolved. *Draft L1248.* [DRAFT]

### Webhooks

177. **C177.** Stable signed event IDs/timestamps, raw-body verification, retries, and receiver deduplication support at-least-once webhook delivery. *Draft L1255-L1259.* [DRAFT]

### Security

178. **C178.** Exact authority, fixed adapters, replay guards, trusted hook context, bounded proofs, and constrained administration address the listed threat classes. *Draft L1267-L1286.* [DRAFT]

179. **C179.** Multiple RPCs and rebuildable projections mitigate RPC/DB compromise, while on-chain checks independently control fund movement. *Draft L1285-L1286.* [DRAFT]

### Scope

180. **C180.** Category truth, blocked logs, subsidy economics, wallet enforcement, direct recipients, RWA availability, and multi-step atomicity cannot be assumed from product language. *Draft L1290-L1296.* [DRAFT]

### Evm

181. **C181.** EVM transaction rollback does not make off-chain approvals, quotes, relays, indexing, or webhooks atomic. *Draft L1296.* [DRAFT]

### Deployment

182. **C182.** Deployment checks include bounded calls/tokens/signatures, withdrawal under pause, chain addresses, hook flags, rounding, and test/static-analysis evidence. *Draft L1300-L1309.* [DRAFT]

### Testing

183. **C183.** Foundry unit/fuzz/invariant tests and golden vectors can exercise signature, encoding, ledger, replay, rounding, reentrancy, and concurrent-transaction cases. *Draft L1342-L1350.* [DRAFT]

184. **C184.** Protocol fork tests should pin deployment/code and validate actual token/receiver/traits/fee/delta behavior, not only mock adapters. *Draft L1354-L1372.* [DRAFT]

185. **C185.** Backend and acceptance tests must cover idempotency, locks, crashes, outbox, replacements, event gaps/reorgs, and observable payment outcomes. *Draft L1376-L1398.* [DRAFT]

### Maintainability

186. **C186.** The implementation should include inline ASCII diagrams for state transitions, indexing, outbox, execution, hook identity, and Aqua binding. *Draft L1400-L1407.* [DRAFT]

### Merkle

187. **C187.** A balanced Merkle tree gives O(log n) proofs, one root activation write, and bounded persistent consumption state. *Draft L1417-L1420.* [DRAFT]

188. **C188.** On-chain mappings have lower per-call proof/calldata overhead than Merkle proofs, and the draft states that each payment creates one storage write. *Draft L1417-L1420.* [DRAFT]

### Contract

189. **C189.** Avoiding unbounded loops, dynamic string comparisons, full invoice storage, and unnecessary oracle calls limits on-chain complexity. *Draft L1422-L1428.* [DRAFT]

### Db

190. **C190.** Owner/status/time, transaction identity, due-job, block-range, and slot indexes are relevant; cursor pagination and measured partitioning are reasonable defaults. *Draft L1434-L1440.* [DRAFT]

### Queue

191. **C191.** Adaptive log batches, one cursor lease, batched writes, backfill, queue backpressure, RPC rate limits, age metrics, and bounded retries support worker progress. *Draft L1444-L1454.* [DRAFT]

### Performance

192. **C192.** RPC/log consistency and signer nonces will become bottlenecks before PostgreSQL throughput. *Draft L1458.* [DRAFT]

### Workspace

193. **C193.** The user's local Payguard repository contains no application code. *Draft L1464.* [DRAFT]

### Maintainability

194. **C194.** Domain/ABI separation, stable custom-error mapping, and explicit use-case transactions are preferable to leaked protocol types and generic repositories. *Draft L1468-L1479.* [DRAFT]

### Deployment

195. **C195.** Startup should validate chain IDs, deployments/code hashes, tokens, signer configuration, and finality instead of silently defaulting networks. *Draft L1483.* [DRAFT]

196. **C196.** Foundry artifacts can supply shared ABI bindings, with drift checks for API/worker consistency. *Draft L1487.* [DRAFT]

### Testing

197. **C197.** Formatting/types, unit/property/invariant, DB/E2E/fork, static-analysis, ABI, gas, and deployment checks can form CI gates. *Draft L1492-L1501.* [DRAFT]

### Observability

198. **C198.** Correlation IDs and secret/metadata redaction make payment logs joinable without exposing credentials. *Draft L1512-L1517.* [DRAFT]

199. **C199.** Verdict, transaction, RPC, indexer, outbox, reconciliation, subsidy, and encoding metrics/alerts help detect demo-affecting faults. *Draft L1521-L1547.* [DRAFT]

### Deployment

200. **C200.** Pinned deployment/fork state, deterministic seeding, preflight, direct-transfer fallback, and observed rather than hardcoded success improve demo repeatability. *Draft L1551-L1555.* [DRAFT]

### Sequencing

201. **C201.** Schemas and adapter interfaces should be frozen before feasibility work on target-chain deployments and protocol adapters. *Draft L1565-L1609.* [DRAFT]

202. **C202.** Shared hashes, ABI, migrations, and adapter interfaces need coordinated ownership across parallel implementation lanes. *Draft L1593-L1599.* [DRAFT]

### Scope

203. **C203.** The fifteen proposed defaults are decisions rather than proof that dependencies/deployments work. *Draft L1619-L1633.* [DRAFT]

204. **C204.** Autonomy, token/budget semantics, approval authority, subsidies, credentials, liquidity, protocol traits, finality, gas payer, and sponsor eligibility remain unresolved. *Draft L1637-L1648.* [DRAFT]

### Sequencing

205. **C205.** Schema, reference kernel, protocol verification, subsidy equations, transaction/indexer persistence, and adversarial reconciliation are explicit implementation gates. *Draft L1658-L1714.* [DRAFT]

### Scope

206. **C206.** Cross-chain atomic execution, arbitrary token semantics, upgradeable core, open plugins, multi-asset oracles, distributed DB/microservices, and mandatory identity integrations are outside v1. *Draft L1722-L1733.* [DRAFT]

### Workspace

207. **C207.** The product document was the only implementation input, and the local Git repository was empty with no commits or implemented components. *Draft L1741-L1743.* [DRAFT]

### Dependencies

208. **C208.** OpenZeppelin, official 1inch/Uniswap code, viem, PostgreSQL, and optional BullMQ provide reusable building blocks. *Draft L1747-L1752.* [DRAFT]

### Workspace

209. **C209.** No SuzuPay repository, schema, API contract, or export was supplied as verified reusable integration material. *Draft L1754-L1756.* [DRAFT]

210. **C210.** The review reports completed review stages, an independent Codex pass, enumerated issue counts, and a numerical review score. *Draft L1762-L1774.* [DRAFT]

### Sources

211. **C211.** The listed external standards, repositories, audits, and framework documentation support the cited protocol/framework behaviors. *Draft L1782-L1796.* [DRAFT]

### Deployment

212. **C212.** Deployment/code hashes, wallet permission support, audit remediation, and sponsor requirements still require independent verification. *Draft L1802-L1806.* [DRAFT]

### Workspace

213. **C213.** An independent outside-voice pass ran on the first 30 KB of the notebook and found the overall one-month scope not credible. *Draft L1812-L1816.* [DRAFT]

### Scope

214. **C214.** Exact preapproved merchant/invoice/amount/route/adapter slots leave the agent mostly scheduling, not autonomous merchant selection. *Draft L1818.* [DRAFT]

### Consent

215. **C215.** A signature over a Merkle root does not prove the wallet displayed its leaves or that a human saw the same plan; golden vectors do not establish informed consent. *Draft L1820.* [DRAFT]

### Quotes

216. **C216.** Binding expiring quote calldata makes re-quoting change authorization; this conflicts with unrestricted delayed execution. *Draft L1822.* [DRAFT]

### Budget

217. **C217.** The draft mixes input and settlement units and omits an explicit outputToken == settlementToken check. *Draft L1824.* [DRAFT]

218. **C218.** Escalation has no defined override matrix and conflicts with an invariant that all approved payments remain under every cap. *Draft L1826.* [DRAFT]

### Relay

219. **C219.** A funded relayer is msg.sender for its own transaction; broadcasting an agent-signed EOA transaction does not make the broadcaster pay gas. *Draft L1828.* [DRAFT]

### Custody

220. **C220.** The shared vault pools custody, and the numbered execution sequence omits debiting the payer's internal ledger. *Draft L1830.* [DRAFT]

### Security

221. **C221.** A compromised agent can execute every currently valid slot unless timing, ordering, or exclusivity are enforced. *Draft L1832.* [DRAFT]

### Aqua

222. **C222.** Aqua maker allowances/strategy authority may conflict with a one-call-authority design; an integration experiment is needed. *Draft L1834.* [DRAFT]

### Subsidy

223. **C223.** A merchant rebate can be a discount rather than LP subsidy; different input/output currencies create a denomination problem. *Draft L1836.* [DRAFT]

### Sequencing

224. **C224.** Target-chain, receiver, allowance, and wallet capability verification should precede freezing dependent interfaces. *Draft L1838.* [DRAFT]

### Scope

225. **C225.** A per-task escrow, direct transfer, one integration, and thin client are a lower-dependency baseline than the full proposed stack. *Draft L1840.* [DRAFT]

226. **C226.** The twelve tension rows remain unadopted decisions, rather than corrections already incorporated into the main draft. *Draft L1846-L1857.* [DRAFT]

227. **C227.** The draft's final clearance depends on choosing authorization, units, subsidy, chain/deployments, and finality semantics. *Draft L1859-L1876.* [DRAFT]

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

## 4. Open questions and assumptions

This register distinguishes a searched factual gap from a deliberately unimplemented proposal, a product decision and an excluded nontechnical judgment. None is silently filled with a guessed deployment, API or test result.

| ID | What remains uncertain / what was established | Evidence and disposition |
|---|---|---|
| O01 | Draft and outside voice make one-month/scope-duration judgments | No timeline is evaluated. The request excludes those judgments; no team-capacity estimate is invented. |
| O02 | Must the human preapprove exact purchases, or may the agent choose within a bounded set? | The product promises budget/rules; the draft changes this to exact slots. This rebuild selects bounded choice and documents exact slots as an optional stricter mode. Product choice, not an externally verifiable fact. |
| O03 | Original manifestId/root derivation and tree convention are undefined | StandardMerkleTree double hashing was verified; the draft's possible circular derivation is conditional on how manifestId is chosen. The optional corrected root-independent construction is specified, but no vectors/compiler test was executed. [MERKLE_CODE] [EIP712] |
| O04 | Actual selected wallet supports the desired ERC-7715 grant and contract-wallet ownership path | The standard and current SDK were retrieved. Robinhood smart-account support is not the same table as Advanced Permissions support. No live wallet was exercised. Native agent EIP-712 is selected; ERC-7715 and deployed ERC-1271 owner coverage require their own acceptance tests. [EIP7715] [METAMASK_RPC] [METAMASK_NET] |
| O05 | Public Aqua/v4 addresses, compatible code and chosen liquidity actually work together today | Fresh docs resolved the cached address/tag disagreement; no bytecode, allowance, balance or payment RPC probe was performed. Local deployments are chosen instead. The original serial Aqua-plus-v4 adapter remains a separate unproven composition. [AQUA_ADDR] [AQUA_SDK] [V4_ADDRESSES] |
| O06 | Robinhood testnet's actual safe/finalized tag behavior and provider retention/rate limits | Network and RPC references were retrieved, but endpoint capability was not exercised. No numeric provider quota or confirmation rule is assumed. Local results are explicitly LOCAL_DEMO. [RH_CONNECT] [RPC_DOC] [ETH_FINALITY] |
| O07 | Actual issuer-backed RWA/USDC contracts, transfer behavior, usable pool and price/sequencer feeds | The retrieved testnet token list does not establish the original AAPL/NVDA/USDC pool. P0 uses plainly labeled mRWA/mUSDC and no USD oracle. Issuer assets and any later feed need token-specific verification. [RH_TOKENS] [CHAINLINK] |
| O08 | An Ethereum-compatible KMS signing adapter and operational permissions | AWS key/sign APIs exist, but the DER/low-s/recovery pipeline and credentials were not tested. KMS is not a P0 dependency. [KMS_SPEC] [KMS_SIGN] [OZ_CRYPTO] |
| O09 | Public merchant webhook delivery/signing interoperability | The draft specifies a custom mechanism, not an implemented API. P0 uses authenticated polling and durable read models. Public webhooks require exact raw-body signing, duplicate-delivery tests and receiver agreement. [JWS] [BULL_IDEMP] |
| O10 | Mandatory ASCII diagrams / universally best code organization | These are conventions or judgments, not external technical requirements. They are not release blockers. |
| O11 | Which subsystem bottlenecks first, gas comparisons and production scale | No workload benchmark or gas measurement was supplied/executed. Do not treat the draft prediction or one-storage-write claim as measurement. |
| O12 | Another machine's empty Git repository, historical Codex run and claimed review score | The two attached documents are available; the local Mac workspace and prior execution logs are not. The claims remain provenance assertions, not engineering evidence. |
| O13 | All proposed new application code, SQL migration, complete package installation, hashes and end-to-end behavior | This session retrieved docs/source/registry records and checked document integrity. It did not compile/deploy Solidity, start PostgreSQL, install the selected Node package graph or run an EVM payment. The companion ABI/SQL/API files are proposed specifications. Full compiler/lock resolution, bytecode hashes, signature vectors, DB migration and acceptance gates are mandatory before calling the demo working. |
| O14 | SuzuPay merchant API, export, schema, rights to reusable data and operational console behavior | No such integration material is attached. This does not imply the business/API does not exist; it means it cannot be substituted for an implementation contract. Use synthetic fixtures until a real export/interface is supplied. |
| O15 | Whether independent adapters/local deployments satisfy sponsor-specific judging requirements | Not established in this technical review. The rebuild explicitly does not claim the same integration depth as a custom serial Aqua/v4 opcode path. No prize amount or eligibility assertion is carried forward. |
| O16 | Exact HTTP endpoint implementation and future browser origin/gateway arrangement | Every /v1 path is a newly specified PayGuard API, not a discovered external endpoint. Same-origin routing, cookie/CSRF behavior, correct SIWE domain and wallet chain changes require browser integration tests. For an HTTPS cookie deployment, do not assume a Secure cookie works over an arbitrary HTTP development origin. [FASTIFY_SCHEMA] [EIP4361] [EIP1193] [CSRF] |
| O17 | The custom merchant-subsidy composition, LP rounding and code-level context binding | donate/settle/fee primitives are verified, but their new composition was not executed. The proposed invoice-denominated subsidy is not promised to equal a counterfactual input-token LP fee. Test actual pool/fund/recipient changes and in-range liquidity. [V4_INTERFACE] [V4_MANAGER] [V4_POOL] |

**Source conflicts actually encountered.** Cached Exa Aqua-address content was older than a fresh Firecrawl page; fresh retrieval and the fetched v1.0.2 source tag resolved the address/tag claim. Viem repository main advertised 2.56.4 while its exact npm version returned 404; the fresh registry supplied published 2.56.3. A cached pg request returned a latest-package page rather than the requested version; fresh direct registry retrieval confirmed pg 8.20.0. The source register identifies the exact retained references. These conflicts are why repository main, a cached search result and a currently published package are not interchangeable evidence.

**What the present verification does and does not establish.** The claim ledger traces 227 consolidated technical assertions/proposals to the draft and supplies verdicts/corrections. Retrieved docs and implementation sources support the protocol mechanisms. A proposed design is not an implementation test: ABI/code graphs, the SQL schema and new API endpoints remain O13/O16 until executed. No statement in this report should be read as a completed deployment, an audit of PayGuard or confirmation that a public testnet is currently funded/liquid.

## 5. Final verdict

**Buildable as a full-stack hackathon demo: YES. Implement the corrected bounded-policy architecture, not the draft unchanged.**

The draft's independent authorization core is worth retaining. Its mixed-unit invariant, relayer caller check, invoice replay shortcut, pooled-custody description, incomplete schemas, quote commitment and finality naming need correction. Much of its broad infrastructure is optional, not a reason to label the project infeasible. The alternative-adapter rebuild can demonstrate a real DB-backed API, wallet/session signatures, deterministic ALLOW/BLOCK/ESCALATE behavior and an actual single-chain token settlement.

**The original automatic serial Aqua/SwapVM -> Uniswap v4 -> merchant-paid-fee path is not verified or cleared by this review.** Its missing settlement composition is not fixed by adding an opcode or a diagram arrow. This is an explicit scope boundary, not a claim that the composition is impossible. Its smallest credible proof is a deployed transaction satisfying every token/callback/recipient/fee obligation, using the exact compiled fork and encoder. [SWAPVM_CODE] [AQUA_ROUTING] [V4_MANAGER]

### Ranked risks by demo-breaking potential

| Rank | Risk | Required evidence before staging |
|---|---|---|
| 1 | Correct-looking code calls the wrong protocol ABI, compiler/hardfork combination or leaves v4 caller deltas unpaid | Bare protocol swap first, then signed vault payment; pin separate compiler/source graphs and assert all actual token results |
| 2 | Signature domain/caller identity, replay or budget-unit error rejects legitimate payment or permits the wrong one | Golden hashes, correct relayer/agent distinction, hard input/output caps, duplicate-invoice and mutated-approval negative tests |
| 3 | Public chain lacks the expected router/token/liquidity or depends on unavailable faucet/RPC/wallet features | Prefer seeded local actual contracts; otherwise verify code, bindings, wallet capability, balances and a real transaction on that exact deployment |
| 4 | Subsidy implementation sets zero LP fee without funding compensation, settles the wrong account or runs out of in-range liquidity | Per-currency conservation, donation/fee-growth evidence, empty-fund fallback and price-bound tests |
| 5 | API/worker crash creates a new logical payment or falsely reports a lost transaction as failed/successful | Persist raw transaction before broadcast; restart after simulated accept-then-timeout; show the same payment identity and canonical receipt |
| 6 | Future frontend signs/displays different fields, uses stale chain/account context or treats submission as settlement | Exercise the documented API with wallet signing, compare decoded payloads, enforce origin/auth and render the separate confidence/state fields |

### Minimum viable technical scope

The **smallest firewall proof** is one per-owner vault, one plain settlement token, signed merchant/agent messages, a bounded policy with exact owner escalation, on-chain invoice/nonce consumption, a PostgreSQL-backed API, one worker/relayer and receipt-backed polling. This is a genuine PayGuard proof, but not an RWA StockPay proof.

The **recommended product showcase** adds one actual v4 exact-output route with seeded mRWA/mUSDC liquidity. Include the merchant-funded donation hook only when retaining the claim that the merchant subsidizes LP fees; otherwise state plainly that normal swap fees apply. Keep Aqua as a separately demonstrated second adapter unless the serial composition has independently passed its token-conservation test. No live LLM, external oracle, World/ENS, ERC-7715, Redis, Kafka, KMS, proxy upgrade or production resolver is necessary for this selected demonstration.

Acceptance is concrete: one valid invoice settles exact output; one over-budget or substituted invoice does not move funds; one 180-unit invoice settles only after the exact owner approval; retry does not pay twice; a failed swap leaves all policy/invoice state unused; and a backend restart recovers the same transaction. That is the point at which the project is demoable, rather than merely diagrammed.

## Retrieved source register

All entries were retrieved during this review session on September 12, 2026. A URL identifies its upstream source; an entry marked source code may be a moving branch unless an exact tag/commit appears in the URL. The deployment lock and remaining runtime checks are in sections 3 and 4.

### EIP712

**EIP-712 typed structured data**. Type: standard. Retrieved: 2026-09-12.

Supports: Domain/type hashing; dynamic field hashing; explicitly does not itself provide replay protection.

Reference: [EIP712]

### EIP1271

**ERC-1271 contract signatures**. Type: standard. Retrieved: 2026-09-12.

Supports: Contract-wallet signature validation interface and magic return value.

Reference: [EIP1271]

### EIP140

**EIP-140 REVERT**. Type: standard. Retrieved: 2026-09-12.

Supports: Reverts state and logs in reverted execution; does not roll back an off-chain workflow.

Reference: [EIP140]

### EIP4361

**Sign-In with Ethereum**. Type: standard. Retrieved: 2026-09-12.

Supports: Login message fields and verification; login is not spending authorization.

Reference: [EIP4361]

### EIP1898

**Block-hash RPC selectors**. Type: standard. Retrieved: 2026-09-12.

Supports: Block-hash and requireCanonical selectors for specified state RPC methods. Provider support still must be tested.

Reference: [EIP1898]

### EIP20

**ERC-20**. Type: standard. Retrieved: 2026-09-12.

Supports: Transfer/transferFrom/approve semantics; false return handling; decimals is optional.

Reference: [EIP20]

### EIP1559

**Transaction fee mechanics**. Type: standard. Retrieved: 2026-09-12.

Supports: Transaction sender, signed transaction fields and fee payment; a network broadcaster does not become gas payer.

Reference: [EIP1559]

### EIP2771

**Native meta-transactions**. Type: standard. Retrieved: 2026-09-12.

Supports: Relayed original signer differs from msg.sender; trusted-forwarder validation is one solution, not the only one.

Reference: [EIP2771]

### EIP4337

**Account abstraction**. Type: standard. Retrieved: 2026-09-12.

Supports: UserOperations, EntryPoint, bundlers and optional paymasters are additional architecture components.

Reference: [EIP4337]

### EIP7715

**Request execution permissions**. Type: standard. Retrieved: 2026-09-12.

Supports: Permission request, adjustment, context, dependencies, support discovery, revocation; not arbitrary application policy enforcement.

Reference: [EIP7715]

### EIP1193

**Wallet provider API**. Type: standard. Retrieved: 2026-09-12.

Supports: Provider.request, wallet errors and account/network change events; window.ethereum is a convention.

Reference: [EIP1193]

### EIP1153

**Transient storage**. Type: standard. Retrieved: 2026-09-12.

Supports: Transient storage is transaction-local and requires an EVM implementing these opcodes.

Reference: [EIP1153]

### SOL_SECURITY

**Solidity security considerations**. Type: official documentation. Retrieved: 2026-09-12.

Supports: External-call reentrancy, checks-effects-interactions, bounded iteration; defensive patterns are not a proof of a new contract.

Reference: [SOL_SECURITY]

### SOL_ABI

**Solidity ABI specification**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Typed encoding, selectors, tuples, uint256 representation, and packed-encoding ambiguity.

Reference: [SOL_ABI]

### SOL_GLOBALS

**Solidity global variables**. Type: official documentation. Retrieved: 2026-09-12.

Supports: block.chainid, Unix-second block.timestamp, current-call msg.sender, ABI encoding and revert.

Reference: [SOL_GLOBALS]

### OZ_CRYPTO

**OpenZeppelin cryptography API**. Type: official documentation. Retrieved: 2026-09-12.

Supports: ECDSA, EIP712, SignatureChecker and MerkleProof APIs; match a selected release, not just moving docs.

Reference: [OZ_CRYPTO]

### OZ_SIG

**OpenZeppelin SignatureChecker v5.4.0**. Type: source code. Retrieved: 2026-09-12.

Supports: EOA versus ERC-1271 validation and time-dependent contract signature validity.

Reference: [OZ_SIG]

### OZ_TOKEN_DOC

**OpenZeppelin ERC-20 utilities**. Type: official documentation. Retrieved: 2026-09-12.

Supports: SafeERC20 wrappers do not establish economic delta correctness or arbitrary token compatibility.

Reference: [OZ_TOKEN_DOC]

### OZ_SAFE

**SafeERC20 v5.4.0**. Type: source code. Retrieved: 2026-09-12.

Supports: forceApprove, false/no-return handling; standard allowance clearing does not clear ERC-7674 temporary allowance.

Reference: [OZ_SAFE]

### OZ_GUARD

**ReentrancyGuard v5.4.0**. Type: source code. Retrieved: 2026-09-12.

Supports: Storage-based guard; guarded entry points cannot call each other directly.

Reference: [OZ_GUARD]

### MERKLE_DOC

**OpenZeppelin Merkle tree library**. Type: official repository. Retrieved: 2026-09-12.

Supports: Standard tree construction, sorted-pair convention and interoperable verification.

Reference: [MERKLE_DOC]

### MERKLE_CODE

**OpenZeppelin Merkle hashing**. Type: source code. Retrieved: 2026-09-12.

Supports: standardLeafHash double-hashes ABI encoding; standardNodeHash sorts sibling hashes.

Reference: [MERKLE_CODE]

### AQUA_CODE

**Aqua registry implementation**. Type: source code. Retrieved: 2026-09-12.

Supports: ship hashes raw strategy bytes; virtual balances; pull by app; push transfers from its caller to maker. Moving branch, not a deployment pin.

Reference: [AQUA_CODE]

### AQUA_SDK

**Aqua and SwapVM SDK overview**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Aqua SDK 0.3.0 and SwapVM SDK 0.4.0; CallInfo encoders; taker threshold/receiver; published/deployed ABI and main-branch drift.

Reference: [AQUA_SDK]

### AQUA_ADDR

**Fresh verified-address reference**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Fresh scrape supersedes stale search copy: vanity pair, v1.0.2 tag/32c687c2, per-chain checks and incomplete testnet-router evidence. Documentation claim, not our RPC verification.

Reference: [AQUA_ADDR]

### AQUA_ROUTING

**Aqua access, resolvers and Pathfinder**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Aqua settlement is not automatic cross-venue routing; credentialed production strategies differ from self-authored demo strategies.

Reference: [AQUA_ROUTING]

### SWAPVM_CODE

**SwapVM v1.0.2 implementation**. Type: source code. Retrieved: 2026-09-12.

Supports: Five-argument quote/swap; program then settlement legs; Aqua versus signature authorization; maker/taker receiver distinction; exact pragma 0.8.30.

Reference: [SWAPVM_CODE]

### SWAPVM_OPS

**AquaOpcodes v1.0.2**. Type: source code. Retrieved: 2026-09-12.

Supports: Array-dispatched instruction set, reserved gaps and no registered arbitrary 0xF4 instruction.

Reference: [SWAPVM_OPS]

### SWAPVM_ROUTER

**AquaSwapVMRouter v1.0.2**. Type: source code. Retrieved: 2026-09-12.

Supports: Five constructor arguments and instruction-table wiring.

Reference: [SWAPVM_ROUTER]

### SWAPVM_BUILD

**SwapVM v1.0.2 build configuration**. Type: source code. Retrieved: 2026-09-12.

Supports: Solidity 0.8.30, via-IR, optimizer and distinct compilation settings.

Reference: [SWAPVM_BUILD]

### AQUA_AUDIT

**OpenZeppelin Aqua/SwapVM MVP audit**. Type: independent audit. Retrieved: 2026-09-12.

Supports: Commit-scoped external audit: token binding, external logic, quote/swap, receiver traits, token assumptions and accounting. Not an audit of PayGuard or every subsequent revision.

Reference: [AQUA_AUDIT]

### V4_MANAGER

**Uniswap v4 PoolManager source**. Type: source code. Retrieved: 2026-09-12.

Supports: Exact pragma 0.8.26; unlock callback; per-caller deltas; settle/settleFor/take/donate; no outstanding deltas at unlock completion.

Reference: [V4_MANAGER]

### V4_INTERFACE

**Uniswap v4 IPoolManager**. Type: source code. Retrieved: 2026-09-12.

Supports: Concrete public methods, arbitrary take recipient, donation to in-range LPs, errors and swap accounting.

Reference: [V4_INTERFACE]

### V4_FEE

**Uniswap v4 LPFeeLibrary**. Type: source code. Retrieved: 2026-09-12.

Supports: Dynamic and override flags; fee units; dynamic initial LP fee is zero.

Reference: [V4_FEE]

### V4_HOOK_INTERFACE

**Uniswap v4 IHooks**. Type: source code. Retrieved: 2026-09-12.

Supports: Hook arguments, selectors and return-delta/fee conventions.

Reference: [V4_HOOK_INTERFACE]

### V4_POOL

**Uniswap v4 pool implementation**. Type: source code. Retrieved: 2026-09-12.

Supports: Zero-liquidity donation error, fee-growth accounting and independent protocol-fee state.

Reference: [V4_POOL]

### V4_BUILD

**Uniswap v4 core build configuration**. Type: source code. Retrieved: 2026-09-12.

Supports: Solidity 0.8.26 and Cancun target; separate from exact-0.8.30 SwapVM source graph.

Reference: [V4_BUILD]

### V4_DEPLOY

**Uniswap hook deployment**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Address permission flags, HookMiner and CREATE2; test cheatcodes differ from network deployment.

Reference: [V4_DEPLOY]

### V4_IDENTITY

**Original sender inside hooks**. Type: official documentation. Retrieved: 2026-09-12.

Supports: PoolManager calls hook; sender is typically router; original user must be authenticated separately.

Reference: [V4_IDENTITY]

### V4_ADDRESSES

**Uniswap deployment reference**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Deployments vary by chain. Does not prove the selected testnet has an initialized liquid chosen pool.

Reference: [V4_ADDRESSES]

### METAMASK_NET

**MetaMask supported networks**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Smart-account support is separate from Advanced Permissions support; Robinhood is listed in the former, not the latter retrieved table.

Reference: [METAMASK_NET]

### METAMASK_RPC

**MetaMask wallet-client actions**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Current SDK signer-based request differs from earlier to-based examples; returned context drives redemption.

Reference: [METAMASK_RPC]

### RH_CONNECT

**Robinhood network configuration**. Type: official documentation. Retrieved: 2026-09-12.

Supports: 4663 mainnet, 46630 testnet, ETH gas, rate-limited public RPC; archive access for historical reads.

Reference: [RH_CONNECT]

### RH_TOKENS

**Robinhood token-contract reference**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Retrieved testnet list contains USDG and five stocks; does not establish AAPL/NVDA/USDC availability or pool liquidity.

Reference: [RH_TOKENS]

### RH_PROTOCOL

**Robinhood protocol deployments**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Chain-native contract references including Permit2; not evidence for a chosen Aqua/v4 payment path.

Reference: [RH_PROTOCOL]

### FOUNDRY_ANVIL

**Anvil reference**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Local node, explicit hardfork, deterministic accounts, state persistence and mining controls.

Reference: [FOUNDRY_ANVIL]

### FOUNDRY_DEPLOY

**Foundry deployment scripts**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Simulation versus actual broadcast, deployment receipts and resume behavior.

Reference: [FOUNDRY_DEPLOY]

### FOUNDRY_TEST

**Foundry invariant testing**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Randomized stateful invariant campaigns; tests are evidence, not a formal proof of all executions.

Reference: [FOUNDRY_TEST]

### PG_NUMERIC

**PostgreSQL 17 exact numeric**. Type: official documentation. Retrieved: 2026-09-12.

Supports: numeric exactness and scale coercion; bigint width; uint256 additionally needs integral/range restrictions.

Reference: [PG_NUMERIC]

### PG_JSON

**PostgreSQL 17 JSON types**. Type: official documentation. Retrieved: 2026-09-12.

Supports: json preserves text; jsonb does not preserve key order/whitespace/duplicates; store exact signed bytes separately.

Reference: [PG_JSON]

### PG_LOCK

**PostgreSQL 17 SELECT and locking**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Row locks, SKIP LOCKED queue use, statement syntax and locked-row behavior.

Reference: [PG_LOCK]

### PG_ISOLATION

**PostgreSQL 17 transaction isolation**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Visibility, concurrent updates and transaction-isolation limits; SQL transactions do not include EVM commits.

Reference: [PG_ISOLATION]

### PG_CONSTRAINT

**PostgreSQL 17 constraints**. Type: official documentation. Retrieved: 2026-09-12.

Supports: CHECK, NOT NULL, UNIQUE and referential constraints; cross-row invariants need suitable indexes/transactions.

Reference: [PG_CONSTRAINT]

### PG_PARTIAL

**PostgreSQL partial indexes**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Predicate-limited indexes and partial unique indexes.

Reference: [PG_PARTIAL]

### PG_CLIENT

**node-postgres transactions**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Use one checked-out client for BEGIN/queries/COMMIT or ROLLBACK.

Reference: [PG_CLIENT]

### PG_TYPES

**node-postgres type parsing**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Strings for unparsed types; JSON parsing; choose explicit text representation for atomic amounts.

Reference: [PG_TYPES]

### PG_PACKAGE

**Published pg 8.20.0**. Type: package registry. Retrieved: 2026-09-12.

Supports: Fresh registry response verifies selected package, Node >=16, gitHead c9070cc8d526fca65780cedc25c1966b57cf7532.

Reference: [PG_PACKAGE]

### PRISMA_TYPES

**Prisma special fields/types**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Decimal/BigInt serialization requires care. Prisma is not required by rebuilt design.

Reference: [PRISMA_TYPES]

### BULL_IDEMP

**BullMQ idempotent jobs**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Retries need idempotent business effects.

Reference: [BULL_IDEMP]

### BULL_REMOVE

**BullMQ auto-removal**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Removed job IDs no longer deduplicate later submissions.

Reference: [BULL_REMOVE]

### FASTIFY_SCHEMA

**Fastify validation/serialization**. Type: official documentation. Retrieved: 2026-09-12.

Supports: JSON Schema request validation, response serialization, asynchronous auth hooks; default coercion/default insertion/removal must be disabled on signed objects.

Reference: [FASTIFY_SCHEMA]

### FASTIFY_PACKAGE

**Published Fastify 5.12.1**. Type: package registry. Retrieved: 2026-09-12.

Supports: Selected release is published; gitHead 7d196a998c422062a3aaa3f8041db91ad576cea0.

Reference: [FASTIFY_PACKAGE]

### FASTIFY_CODE

**Fastify v5.12.1 package/source**. Type: source code. Retrieved: 2026-09-12.

Supports: Versioned implementation/dependency reference for the selected release.

Reference: [FASTIFY_CODE]

### NODE_RELEASE

**Node.js release policy/status**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Node 24 is an LTS line. Patch/image digest must be recorded in implementation lock, not invented.

Reference: [NODE_RELEASE]

### TS_PACKAGE

**Published TypeScript 5.9.3**. Type: package registry. Retrieved: 2026-09-12.

Supports: Selected published compiler, Node >=14.17, gitHead c63de15a992d37f0d6cec03ac7631872838602cb. Not claimed latest.

Reference: [TS_PACKAGE]

### VIEM_PACKAGE

**Published viem registry metadata**. Type: package registry. Retrieved: 2026-09-12.

Supports: Fresh response reports 2.56.3 and TypeScript >=5.0.4. Repository main 2.56.4 was not published at its queried registry endpoint.

Reference: [VIEM_PACKAGE]

### VIEM_SIM

**viem contract simulation**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Uses eth_call; returns simulation/write request; does not guarantee later inclusion or successful execution.

Reference: [VIEM_SIM]

### VIEM_SIM_CODE

**viem 2.56.3 simulation implementation**. Type: source code. Retrieved: 2026-09-12.

Supports: Versioned encode/call/decode implementation.

Reference: [VIEM_SIM_CODE]

### VIEM_RECEIPT

**viem receipt/replacement action**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Confirmation counts, pending polling and onReplaced notifications, not durable application state.

Reference: [VIEM_RECEIPT]

### VIEM_RECEIPT_CODE

**viem receipt implementation**. Type: source code. Retrieved: 2026-09-12.

Supports: Polling and same-nonce replacement logic; state is process-local.

Reference: [VIEM_RECEIPT_CODE]

### VIEM_SIWE

**viem SIWE verification**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Expected message/domain/nonce/time checks plus signature verification.

Reference: [VIEM_SIWE]

### VIEM_SIWE_CODE

**viem SIWE source**. Type: source code. Retrieved: 2026-09-12.

Supports: Parses/validates SIWE and verifies hash; application still checks expected URI/chain and one-use challenge.

Reference: [VIEM_SIWE_CODE]

### RPC_DOC

**Ethereum JSON-RPC**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Chain ID, block/state reads, receipts, transaction submission and safe/finalized tags.

Reference: [RPC_DOC]

### RPC_CODE

**Execution API transaction schema**. Type: official specification source. Retrieved: 2026-09-12.

Supports: Official transaction and receipt schema; use with node behavior and canonical block checks.

Reference: [RPC_CODE]

### ETH_FINALITY

**Ethereum proof-of-stake finality**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Consensus finality is not merely a chosen count of confirmation blocks.

Reference: [ETH_FINALITY]

### CSRF

**OWASP CSRF prevention**. Type: security guidance. Retrieved: 2026-09-12.

Supports: Cookie authentication requires CSRF/origin handling; SameSite alone is not a universal replacement.

Reference: [CSRF]

### SESSION

**OWASP session management**. Type: security guidance. Retrieved: 2026-09-12.

Supports: Unpredictable session identifiers, cookie protection and server-side session lifecycle.

Reference: [SESSION]

### JCS

**RFC 8785 JSON canonicalization**. Type: standard. Retrieved: 2026-09-12.

Supports: Deterministic JSON has explicit numeric/string rules; a database JSON object is not automatically signed canonical bytes.

Reference: [JCS]

### JWS

**RFC 7515 signatures**. Type: standard. Retrieved: 2026-09-12.

Supports: Signature envelope does not itself establish recipient trust or consumed-invoice replay state.

Reference: [JWS]

### ENS_DOC

**ENS resolver interfaces**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Text record read/write methods and mutable records.

Reference: [ENS_DOC]

### ENS_CODE

**ENS TextResolver source**. Type: source code. Retrieved: 2026-09-12.

Supports: Authorized setText changes record storage; identity/category immutability is not inherent.

Reference: [ENS_CODE]

### CHAINLINK

**Chainlink sequencer-uptime feeds**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Where supported, L2 sequencer checks and grace periods; not proof every target chain has a feed.

Reference: [CHAINLINK]

### KMS_SPEC

**AWS KMS key specs**. Type: official documentation. Retrieved: 2026-09-12.

Supports: ECC_SECG_P256K1 support; infrastructure/key policy is a separate integration.

Reference: [KMS_SPEC]

### KMS_SIGN

**AWS KMS Sign API**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Message/digest signing and response format; Ethereum conversion still needs explicit normalization/recovery handling.

Reference: [KMS_SIGN]

### NEXT_SELF

**Next.js self-hosting**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Next.js is not intrinsically serverless; self-hosting has different lifecycle constraints.

Reference: [NEXT_SELF]

### VERCEL_LIMIT

**Vercel function limits**. Type: official documentation. Retrieved: 2026-09-12.

Supports: Hosted function invocation duration is limited; distinguishes hosting constraints from framework capabilities.

Reference: [VERCEL_LIMIT]

### FOUNDRY_RELEASE

**Foundry stable release listing**. Type: official release record. Retrieved: 2026-09-12.

Supports: Retrieved release list includes v1.8.1. Candidate stable pin, not a locally installed/tested toolchain.

Reference: [FOUNDRY_RELEASE]

### V4_MANAGER_PIN

**Uniswap PoolManager inspected revision**. Type: source code. Retrieved: 2026-09-12.

Supports: Revision d153b048 has exact Solidity 0.8.26; source retrieved for the proposed local build. Resolve full revision in the actual lock.

Reference: [V4_MANAGER_PIN]

### V4_BUILD_PIN

**Uniswap build at inspected revision**. Type: source code. Retrieved: 2026-09-12.

Supports: Solidity 0.8.26, Cancun and compiler options at the inspected revision.

Reference: [V4_BUILD_PIN]

### AQUA_AUDIT_PIN

**Aqua at audit-final revision**. Type: source code. Retrieved: 2026-09-12.

Supports: Concrete audit-final source fetched as comparative evidence; do not assume interchangeable with another tag dependency graph.

Reference: [AQUA_AUDIT_PIN]

### SWAPVM_PACKAGE

**SwapVM v1.0.2 dependency manifest**. Type: source code. Retrieved: 2026-09-12.

Supports: Pins Aqua 0.1.0, solidity-utils 6.9.7, OpenZeppelin 5.4.0 and forge-std v1.11.0; retain actual dependency lock.

Reference: [SWAPVM_PACKAGE]


<!-- Retrieved source links -->
[AQUA_ADDR]: https://business.1inch.com/portal/documentation/aqua/reference/verified-contract-addresses "Fresh verified-address reference"
[AQUA_AUDIT]: https://www.openzeppelin.com/news/1inch-aqua-and-swapvm-mvp-v1.0-audit "OpenZeppelin Aqua/SwapVM MVP audit"
[AQUA_AUDIT_PIN]: https://github.com/1inch/aqua/blob/af53fc31b636c683a6b72cf4755f5aad089c12e8/src/Aqua.sol "Aqua at audit-final revision"
[AQUA_CODE]: https://github.com/1inch/aqua/blob/main/src/Aqua.sol "Aqua registry implementation"
[AQUA_ROUTING]: https://business.1inch.com/portal/documentation/aqua/liquidity-layer/access-resolvers-and-pathfinder "Aqua access, resolvers and Pathfinder"
[AQUA_SDK]: https://business.1inch.com/portal/documentation/aqua/reference/sdk-overview "Aqua and SwapVM SDK overview"
[BULL_IDEMP]: https://docs.bullmq.io/patterns/idempotent-jobs "BullMQ idempotent jobs"
[BULL_REMOVE]: https://docs.bullmq.io/guide/queues/auto-removal-of-jobs "BullMQ auto-removal"
[CHAINLINK]: https://docs.chain.link/data-feeds/l2-sequencer-feeds "Chainlink sequencer-uptime feeds"
[CSRF]: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html "OWASP CSRF prevention"
[EIP1153]: https://eips.ethereum.org/EIPS/eip-1153 "Transient storage"
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
[FASTIFY_CODE]: https://github.com/fastify/fastify/blob/v5.12.1/package.json "Fastify v5.12.1 package/source"
[FASTIFY_PACKAGE]: https://registry.npmjs.org/fastify/5.12.1 "Published Fastify 5.12.1"
[FASTIFY_SCHEMA]: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/ "Fastify validation/serialization"
[FOUNDRY_ANVIL]: https://getfoundry.sh/anvil/reference/ "Anvil reference"
[FOUNDRY_DEPLOY]: https://getfoundry.sh/forge/deploying/ "Foundry deployment scripts"
[FOUNDRY_RELEASE]: https://github.com/foundry-rs/foundry/releases "Foundry stable release listing"
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
[NODE_RELEASE]: https://nodejs.org/en/about/previous-releases "Node.js release policy/status"
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
[PG_PACKAGE]: https://registry.npmjs.org/pg/8.20.0 "Published pg 8.20.0"
[PG_PARTIAL]: https://www.postgresql.org/docs/17/indexes-partial.html "PostgreSQL partial indexes"
[PG_TYPES]: https://node-postgres.com/features/types "node-postgres type parsing"
[PRISMA_TYPES]: https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types "Prisma special fields/types"
[RH_CONNECT]: https://docs.robinhood.com/chain/connecting/ "Robinhood network configuration"
[RH_PROTOCOL]: https://docs.robinhood.com/chain/protocol-contracts/ "Robinhood protocol deployments"
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
[SWAPVM_ROUTER]: https://github.com/1inch/swap-vm/blob/v1.0.2/src/routers/AquaSwapVMRouter.sol "AquaSwapVMRouter v1.0.2"
[TS_PACKAGE]: https://registry.npmjs.org/typescript/5.9.3 "Published TypeScript 5.9.3"
[V4_ADDRESSES]: https://developers.uniswap.org/docs/protocols/v4/deployments "Uniswap deployment reference"
[V4_BUILD]: https://github.com/Uniswap/v4-core/blob/main/foundry.toml "Uniswap v4 core build configuration"
[V4_BUILD_PIN]: https://github.com/Uniswap/v4-core/blob/d153b048/foundry.toml "Uniswap build at inspected revision"
[V4_DEPLOY]: https://developers.uniswap.org/docs/protocols/v4/guides/hooks/hook-deployment "Uniswap hook deployment"
[V4_FEE]: https://github.com/Uniswap/v4-core/blob/main/src/libraries/LPFeeLibrary.sol "Uniswap v4 LPFeeLibrary"
[V4_HOOK_INTERFACE]: https://github.com/Uniswap/v4-core/blob/main/src/interfaces/IHooks.sol "Uniswap v4 IHooks"
[V4_IDENTITY]: https://developers.uniswap.org/docs/protocols/v4/guides/hooks/accessing-msg.sender "Original sender inside hooks"
[V4_INTERFACE]: https://github.com/Uniswap/v4-core/blob/main/src/interfaces/IPoolManager.sol "Uniswap v4 IPoolManager"
[V4_MANAGER]: https://github.com/Uniswap/v4-core/blob/main/src/PoolManager.sol "Uniswap v4 PoolManager source"
[V4_MANAGER_PIN]: https://github.com/Uniswap/v4-core/blob/d153b048/src/PoolManager.sol "Uniswap PoolManager inspected revision"
[V4_POOL]: https://github.com/Uniswap/v4-core/blob/main/src/libraries/Pool.sol "Uniswap v4 pool implementation"
[VERCEL_LIMIT]: https://vercel.com/docs/functions/limitations "Vercel function limits"
[VIEM_PACKAGE]: https://registry.npmjs.org/viem/latest "Published viem registry metadata"
[VIEM_RECEIPT]: https://viem.sh/docs/actions/public/waitForTransactionReceipt "viem receipt/replacement action"
[VIEM_RECEIPT_CODE]: https://github.com/wevm/viem/blob/main/src/actions/public/waitForTransactionReceipt.ts "viem receipt implementation"
[VIEM_SIM]: https://viem.sh/docs/contract/simulateContract "viem contract simulation"
[VIEM_SIM_CODE]: https://github.com/wevm/viem/blob/viem%402.56.3/src/actions/public/simulateContract.ts "viem 2.56.3 simulation implementation"
[VIEM_SIWE]: https://viem.sh/docs/siwe/actions/verifySiweMessage "viem SIWE verification"
[VIEM_SIWE_CODE]: https://github.com/wevm/viem/blob/main/src/actions/siwe/verifySiweMessage.ts "viem SIWE source"
[DRAFT]: inputs/ENGINEERING_ANALYSIS.md "Supplied unverified engineering draft"
[PRODUCT]: inputs/PRODUCT_PLAN.md "Supplied original product plan"
