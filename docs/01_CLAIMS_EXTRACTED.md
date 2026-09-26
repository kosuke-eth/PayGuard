# PayGuard claim register

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


<!-- Retrieved source links -->
[DRAFT]: inputs/ENGINEERING_ANALYSIS.md "Supplied unverified engineering draft"
