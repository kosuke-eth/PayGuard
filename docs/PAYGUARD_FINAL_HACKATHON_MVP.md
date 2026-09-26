# PayGuard: final hackathon MVP and sponsor implementation scope

Decision date: 2026-09-14. Workflow revision: 2.0, backend-first continuation with frontend reuse later.

Companion entry point: [00_PAYGUARD_START_HERE.md](00_PAYGUARD_START_HERE.md). Product scope is unchanged from the preceding final plan; the gate ordering below now explicitly permits backend-first development while reserving browser proof for the frontend gates.

## 1. Product decision

Build one agent-spending firewall with two separately demonstrable settlement routes: Uniswap v4 and 1inch Aqua/SwapVM. Retain the tested direct-payment route as a labeled reference/fallback. Deliver a usable owner console, a controlled agent demo workspace, and a receipt view that shows actual execution evidence.

Do not force Aqua and Uniswap into the same transaction. Do not replace the existing authorization kernel. Do not build an entire merchant platform. Merchant-funded LP subsidy is the first optional extension, not a condition for the two-route MVP.

Pitch:

> A human gives an agent spending limits, not unrestricted access to funds. PayGuard permits valid purchases, asks the owner about specific exceptions, blocks unauthorized attempts, and settles exact merchant payments through an owner-selected DeFi route.

The target user is an operator delegating purchases to an agent. The operator sets authority; the agent selects among authorized merchants; the merchant receives the invoice amount. The demonstration uses clearly labeled mock assets and demo merchants.

This document supersedes the scope decisions in the two attached UI/reduction proposals. It does not silently replace contract types, database migrations or HTTP interfaces. Any necessary interface change must be separately recorded, reviewed and tested.

## 2. Evidence and current implementation

The current-code baseline is the supplied `STAGE5_FRONTEND_BACKEND_INTEGRATION_AUDIT.md`, dated September 14. Its implementation findings are reported evidence, not a fresh repository inspection performed for this document.

The audit records backend branch `backend/contract`, HEAD `2021a87d704364d6206b51ebc3835489c93f3b8c`, plus substantial uncommitted Stage 1-5 work. Therefore the HEAD alone does not reproduce the implementation. It compares frontend `origin/main` at `d88aaf3fa801f600f92b76b7db008b9fce5e2f01`.

| Area | Audit finding | Decision |
|---|---|---|
| Vault and authorization | Per-owner vault, exact signed intents, hard budgets, replay protection and exact owner approvals are implemented/tested | Preserve the kernel |
| Direct payment | HTTP -> worker -> contract -> receipt path exists | Use as the integration baseline |
| PostgreSQL and worker | Durable identities, signed transaction journal, outbox and recovery mechanisms exist | Keep; fix concrete defects, do not expand infrastructure |
| Public read models | Payment/transaction/timeline outputs contain missing or incorrectly projected values | Repair selected response contracts before binding UI |
| Generated integration package | Exists; shared/CLI tests pass, browser integration is not established | Export and browser-test it; do not create a competing SDK |
| Frontend | Reusable presentation over an incompatible in-memory simulator | Retain components; replace authority/data actions |
| v4 | A bare protocol fixture exists; no PayGuard conversion adapter is implemented | Build and prove the adapter |
| Aqua | Deferred, not implemented | Restore as required for the selected 1inch submission |
| Merchant subsidy | Not implemented | Optional extension after both routes work |

The audit reports passing targeted suites, but says its recursive top-level Stage-5 rerun was interrupted. Do not summarize that as a fresh complete wrapper pass. Existing test counts also do not establish browser readiness.

## 3. Sponsor and eligibility boundary

See `SPONSOR_VERIFICATION_2026-09-14.md` for retrieved official URLs, tool provenance and freshness conflicts.

Both selected sponsors have published separate Continuity offerings. Existing PayGuard-specific work predates the Tokyo event, so do not assume Classic or regular-pool eligibility. Preserve the real existing-work baseline and get organizer confirmation of the approved track and partner eligibility. Include the prompts/specifications and AI-use attribution required by the event. Do not reset or manufacture history.

The earlier blanket recommendation to defer Aqua is incompatible with retaining the 1inch Aqua target. Conversely, the Uniswap track does not make a zero-fee hook mandatory. That distinction determines the scope below.

Technical match, registration eligibility and competitive judging are three different questions. Real protocol transfers address technical integration; they do not by themselves prove an approved track or a sufficiently original submission.

## 4. Locked scope

### Required for the core product

- Existing per-owner vault, fixed policy route and supported assets.
- Merchant-authenticated invoice, agent-signed intent and exact owner exception signature.
- Separate input-asset exposure limits and settlement-output budgets.
- Real ALLOW, ESCALATE and BLOCK handling, replay defense and atomic rollback.
- Existing PostgreSQL, API and worker, with corrected public results.
- Browser owner login, policy creation/replacement, approval and activity views.
- Basic deposit/withdraw and pause/revoke actions through existing prepared-transaction endpoints.
- Durable operation/payment polling and reload recovery.
- Controlled demo runner with real actor signatures and real execution.

### Required to call the chosen two-sponsor MVP complete

- Actual PayGuard-controlled Uniswap v4 exact-output payment.
- Actual PayGuard-controlled Aqua/SwapVM exact-output payment against a real shipped strategy.
- Independent executable tests, receipts and token-transfer evidence for both.
- Public source/code maps and required sponsor submission materials.
- An approved event/partner eligibility path for the existing project.

### Optional, in this order

1. Merchant-funded LP subsidy on the v4 route, with proven accounting and accurate fee labels.
2. A thin live-model proposal adapter using exactly the same limited agent interface, with a separately labeled deterministic replay mode.

A live-model adapter may be selected earlier if already available and simple, but it never replaces deterministic acceptance tests or participates in owner authorization. Do not present replay text as live model output.

### Explicitly excluded

Serial Aqua -> custom opcode -> v4 settlement; generalized route optimization; arbitrary user-supplied router programs; multi-chain execution; yield/oracle infrastructure; mandatory Merkle Spend Lockfiles; new custody architecture; general merchant onboarding; World/ENS/ERC-7715 integrations; public webhooks; new queues/microservices; complete admin/explorer/reorg dashboards; frontend framework migration.

Dropping a failing sponsor route is a valid product fallback, but drops the claim that the corresponding integration is complete. Direct transfer cannot stand in for either sponsor demonstration.

## 5. Architecture and actor boundaries

```text
Owner browser wallet
  | SIWE; policy/funding transactions; exact exception signature
  v
Owner console -------- /v1 -------- Fastify API <---- PostgreSQL
                                       ^                  |
                                       |                  | durable work
Demo merchant signer -> Agent runner --+                  v
                                                       Worker
                                                         |
                                                  relayer transaction
                                                         v
                                                  PayGuardVault
                                                   /     |     \
                                           direct       v4     Aqua/SwapVM
                                           transfer    adapter    adapter
                                                        |          |
                                                    v4 pool    shipped maker
                                                        |       strategy
                                                        +-----+----+
                                                              |
                                               output returns to payer vault
                                               then exact merchant payment
                                               inside the same transaction
```

The browser only needs to sign as the human owner. The demo merchant signer issues invoices; the agent runner signs intents; the worker signs the outer gas-paying transaction. Keep their keys and authority separate. No owner key belongs in a production API/worker process. Local fixtures must be explicitly labeled and isolated from real credentials.

The audit is correct that all three signed artifacts are missing from the old demo flow. It is too broad to interpret that as a requirement for the browser to create all three. It must consume the proper artifacts from their actual actors.

Each policy binds one route and input token. Do not put a free route switch on an already-approved payment. For a two-route demonstration, use two clearly labeled agent profiles/keys with independent policies, or an explicit owner policy replacement. Independent policy budgets are not a shared aggregate cap. Display which policy and route a payment uses.

The same invoice cannot be paid once through each adapter. A second legitimate purchase requires a distinct invoice identity; changing route alone does not create a new obligation.

## 6. Sponsor implementation contracts

### 6.1 Uniswap v4: constrained exact-output merchant settlement

Deliver a reusable fixed-pool `PayGuardV4Adapter` and a test suite proving the PayGuard payment semantics, not just a disconnected swap example.

The proposed route is:

1. Vault validates all signed authority and reserves/consumes state inside its atomic execution.
2. Adapter exchanges the authorized input asset for the invoice's exact settlement output through actual v4 PoolManager operations.
3. Callback authenticates PoolManager, handles actual currency deltas, enforces maximum input and settles all obligations.
4. Output returns to the calling vault; unused prefunded input returns to that same vault.
5. Vault independently verifies observed amounts and pays the committed merchant.

Demonstrate a success plus an input-bound/liquidity failure that rolls back invoice and budget consumption. Publish protocol address/pool identifiers, event evidence and code pointers. No custom hook or zero-fee promise is necessary for the baseline stack integration [S2, S5].

The value proposition is authorization-preserving liquidation for agent payments, with a reusable adapter and negative tests. Whether that is competitively distinctive remains a judging question, not an engineering fact.

### 6.2 1inch: policy-constrained Aqua liquidation

Deliver a separately selectable Aqua/SwapVM adapter plus a documented, actually shipped maker strategy. Use the official contracts and actual programmable SwapVM execution rather than a quote API or a logo [S1, S5].

Proposed boundaries:

- Payer vault/adapter is on the taker side. A separate seeded maker supplies settlement-token liquidity.
- Pin the maker, router, token pair, strategy/order/program and approved route.
- Use exact-output mode with an explicit maximum-input threshold and expiry.
- Receive the output at the payer vault and forward it atomically to the merchant.
- Clear residual payer-side allowances and preserve all PayGuard hard limits.
- Prove that an expired or docked strategy, insufficient maker inventory or input-bound failure cannot leave a consumed invoice or spent policy budget.

The strategy lifecycle and token movements should be visible in tests and a small technical evidence panel: maker, strategy hash, shipped status, actual fill and PayGuard receipt. A custom opcode is not a prerequisite. Start with registered existing instructions and the project's verified contract version; do not assume arbitrary opcodes can be appended.

Do not rely on hosted resolver discovery, commercial access or production liquidity appearing automatically. The local fixture owns its setup. Public deployments require their own support/access/liquidity probes. A local fork is explicitly allowed by the 1inch task; confirm the chosen local-deployment presentation with mentors and keep it labeled.

A trivial wrapper may not satisfy the qualitative "sophisticated position" goal. Explain and demonstrate the constrained liquidation behavior and programmable liquidity position, and validate the planned depth with the sponsor. Do not add an unneeded unsafe opcode solely to look complex.

### 6.3 Optional v4 subsidy

Only add this after both required routes and the owner flow pass.

Retain the reviewed design: an authenticated merchant-funded settlement-token contribution to LPs, a correct zero-LP-fee override when funded, and explicit REQUIRED/BEST_EFFORT/NONE behavior. It must prove actual fund movement and settled callback deltas, not decrement a counter and display zero fees. Confirm protocol-fee state separately.

No subsidy claim applies to Aqua unless separately implemented. Zero LP fee does not mean zero gas, zero price impact or universally free payments. If omitted, all UI and pitch copy must say normal swap fees apply. No merchant-subscription or subsidy-management platform is required to demonstrate prefunded fixtures.

## 7. UI: complete owner journey without seven separate applications

Preserve the current visual design and components. The selected scope is four main pages, one demo workspace, and shared modal/drawer views.

| Surface | Required behavior | Scope limit |
|---|---|---|
| Overview | Real token balances, selected agent/policy, remaining budgets, pending approvals and recent activity | No synthetic portfolio USD value or yield analytics |
| Policies | Create/review/activate, replace, inspect and revoke bounded policy; advanced input limits and fixed route | No generic policy language or arbitrary merchant/adapter editor |
| Approvals | Exact merchant/output/input ceiling/route; owner signs exact exception; explicit pending and execution results | No fake World proof and no unsigned approval boolean |
| Activity | Filtered attempts and payments with separate decision/execution/evidence; open receipt drawer | No separate explorer or reorg management dashboard |
| Demo workspace | Issue controlled demo invoices, run real agent proposals, trigger adversarial cases, select preauthorized profile | Not a second ledger or policy engine |
| Vault modal | Prepared finite approval/deposit, withdraw, pause/unpause with actual wallet results | No separate vault-management application |
| Receipt drawer / merchant perspective | Exact delivered amount, recipient, input spent, route, transaction and block evidence | No new merchant account system or public exposure of owner data |

### Display semantics that must change

- Use `mUSDC`/`mRWA` and visible mock/local labels. Do not show invented total dollar portfolio values without a real, explicitly labeled valuation source.
- Use synthetic merchant names such as Demo Compute and Demo Hotel, not brands presented as real integrations.
- Show output and input budgets separately. Format bigint/decimal strings at display boundaries; never convert authoritative atomic amounts through Number.
- "Replace policy" is an owner transaction creating a new immutable policy, not editing an active contract record. Explain changed authorization and policy-local counters before signing.
- "Approve and sign" authorizes one exact intent. "Not now" is not on-chain cancellation. Cancelling an already issued approval requires the actual cancellation transaction.
- Render actual backend reason codes. A 500-unit request can fail multiple limits; do not prewrite which one the contract reports first.
- Never invent a per-rule green trace if the API provides only one overall reason. Show observed verification steps and a separate policy summary.
- Show requested output, maximum authorized input, simulated estimate and actual input as distinct values. Never prefill actual settlement from a quote.
- Keep ALLOW/ESCALATE/BLOCK separate from QUEUED/SUBMITTED/UNKNOWN/SUCCEEDED/REVERTED and confidence/reconciliation.
- A scenario that initially escalated and later settled should preserve that history. Do not overwrite it with a single misleading badge.
- A blocked preflight need not have a transaction hash. A forced reverted transaction must show its real failure receipt without inventing a surviving denial event.
- Activity counters must come from authoritative queries or be explicitly labeled as counts for the loaded page. Never make up aggregate activity.
- A merchant perspective inside the owner session is not a new merchant portal. Separate merchant access, when added, needs its own authorization.

### Real setup and prepared demo mode

The product must support connecting the owner wallet, funding the predeployed vault, creating a policy and signing an exception. These need not all consume stage time.

The demo may start with a seeded, clearly identified deployment and funded/activated demo policies. Its scenario buttons still run real merchant signatures, agent signatures, API commands and transactions. Fixtures are inputs, not fabricated outputs.

Default proposal runner can be deterministic and labeled. A real model can later call the same constrained proposal interface. Never claim prompt injection was observed unless a real model/run demonstrated it; "adversarial proposal" accurately describes a deliberately malicious fixture.

## 8. Concrete remaining fixes

Use audit IDs as traceability, not as a reason to implement every screen or endpoint at once.

| Priority | Audit coverage | Required change |
|---|---|---|
| Integration gate | INT-007, INT-008 | Populate PaymentView input/route/block and receipt amounts, transaction sender/nonce/replacement hashes, normalized timeline evidence; test selected response shapes |
| Integration gate | INT-006 | Validate deployment code/runtime identity against build artifacts and manifest, generated ABI/schema compatibility and enabled routes; fail closed on mismatch |
| Integration gate | INT-001, INT-011 | Browser-consumable existing integration package and real `/v1` client; remove simulator authority from the active app |
| Integration gate | INT-002, INT-009, INT-010 | One browser/API origin, tested cookie/SIWE/CSRF, correct wallet account/chain behavior and invalidation |
| Integration gate | INT-003, INT-004 | Correct actor signatures, common typed structures and lossless amounts |
| Demo gate | INT-005, INT-012, INT-013, INT-014 | Accurate status/error/copy and multi-step owner actions; no fake chain results |
| Recovery gate | INT-015 / SPEC-037 | Fix and test known relayer nonce reconciliation after orphaned execution; never simply decrement an unresolved nonce blindly |
| Deferred | INT-016, INT-017 | Query-library migration and harmless N+1 cleanup are not MVP blockers |

Do not create a separate browser schema system, duplicate integration SDK, generic status mutation endpoint or replacement policy engine. Use existing package/repository boundaries.

Readiness cannot query a magical on-chain ABI registry. Match generated artifacts to deployment/runtime evidence and exercise the needed view calls. Record the checks actually implemented.

An API view returning only a current active intent may be insufficient for historical receipts. Verify that old payments remain bound to the policy/intent/artifacts that actually executed, including after policy replacement.

## 9. Branch and release workflow

First preserve uncommitted work and secrets hygiene. Create an honest reviewed checkpoint/commit or local snapshot with file hashes; do not pretend the old HEAD includes the working tree. Preserve all actual prior history.

Keep `backend/contract` as the implementation base. The colleague owns frontend work, but the combined product must not inherit main's prototype contracts or Express/RAM ledger as a second backend. Use an agreed integration branch/worktree based on the saved backend state. Bring in the frontend presentation deliberately, reviewing root package files, lockfiles, scripts and configuration rather than blindly merging two competing applications.

Use one owner for the shared HTTP/signing/config package. Frontend and sponsor-adapter work can proceed independently once that boundary is stable. Neither adapter lane should rewrite the kernel or change existing signed fields without an explicit decision.

## 10. Implementation sequence, not a timeline estimate

### Gate A: preserve baseline and settle eligibility

Save the actual Stage-5 tree; inventory prior code/designs/AI artifacts; confirm track rules; define the new work that will be claimed. No fake history or hidden pre-event work.

### Gate B: repair the integration contract; prove the browser when frontend work starts

Backend prompts B1-B2 first fix selected read projections, public-package exports, response tests, session/configuration requirements, deployment identity and the demo actor bridge. Prove direct signed payment and exception behavior through the public API and preserve explicit browser-test gaps.

The backend-first workflow may then implement isolated protocol routes without claiming the browser gate passed. F1 must make one browser-triggered direct payment and one browser-signed exception reach a real receipt with correct polling/reload behavior. No full-product release passes before that proof.

This separates interface readiness from browser execution readiness. It is not a requirement to finish all screens before protocol work and not permission to skip the frontend.

### Gate C: implement the two protocol lanes independently

The v4 lane (B3) reuses the bare fixture and builds the real PayGuard adapter. The Aqua lane (B4) pins its separate compiler/dependency graph, ships liquidity and builds its adapter. Both use the B1-B2 integration contract and existing vault authority. No automatic route failover on an already signed payment. B5 proves the combined backend through the public API; it must not claim frontend readiness.

### Gate D: complete the owner console and demo workspace

F0 safely fetches the current main frontend into a backend-based integration branch instead of creating a new UI. F1-F3 connect actual funding/policy/approval flows and the shared receipt/timeline; expose only tested route profiles. Preserve visual quality, remove mock authority, and verify browser amount/signature round trips. The default sequence is backend B0-B5 first, frontend F0-F3 later. An explicitly coordinated parallel workflow may start F0-F2 after B2; F3 still requires B5.

### Gate E: combined acceptance and sponsor evidence

Run from a clean reproducible deployment. Capture real invoice/intent IDs, token transfer events, protocol state, receipts and restart behavior. Test both sponsor routes through the actual product flow. Preserve the underlying tests without recursively re-running all predecessors multiple times at every edit.

### Gate F: optional subsidy, otherwise release

Only pursue subsidy after Gate E. Its failure must not invalidate normal-fee v4 and Aqua functionality. Use explicit enabled capabilities; do not display disabled feature promises. Public testnet deployment is separately gated; it is not implied by local success.

## 11. Demo narrative and acceptance

Use a main v4 profile with 300 mUSDC total output budget, 100 automatic cap, 200 escalation ceiling and an epoch budget/input limits compatible with the demonstrated invoices. Use a separately labeled small-budget Aqua profile so route changes do not mutate approved authority.

| Scene | Action | Required observed result |
|---|---|---|
| Authority | Show owner-approved rules and real vault assets | Policy, route and budgets come from the deployed system |
| Autonomy | Issue 0.50 mUSDC compute invoice; agent signs and submits via v4 | Actual conversion and exact merchant receipt |
| Firewall | Submit an adversarial 500-unit request, then an under-cap unauthorized merchant example if useful | Contract-backed rejection, exact reason, no successful payment |
| Exception | Issue 180-unit hotel invoice; owner signs exact exception | Waiting before approval, then actual settlement with hard limits still enforced |
| Sponsor portability | Issue a different small invoice with the Aqua profile | Shipped SwapVM strategy fill and exact merchant receipt |
| Evidence | Open receipt/activity | Actual hashes, route, amounts, canonical observation and durable history |

Reusing a successful invoice for a duplicate test must not pay it a second time, even with a different agent nonce. Use a distinct invoice for the Aqua purchase, not a route switch to bypass consumption.

The event's published presentation guidance is longer than the earlier thirty-second-only narrative [S3]. Prepare a complete product demonstration that fits its specified format; keep a short version as the opening story, not the entire technical submission.

### Release acceptance

- A user can complete the owner setup and approval path from the browser without backend private knowledge.
- Both selected sponsor routes execute actual protocol contracts and deliver the committed merchant amount.
- Malicious recipient/amount/route changes and duplicate obligations fail.
- An exception cannot bypass hard budgets, revocation or expiry.
- Failed settlement leaves invoice and budget authority unused; input ceilings and payer allowance cleanup hold.
- No operation claims paid from a returned hash, animation, estimate or RAM record.
- Reload/restart and UNKNOWN recover the same operation, not a second payment.
- Wrong deployment or unavailable required route fails visibly.
- Source history, sponsor code maps, feedback artifacts and prior-work disclosure are complete.

## 12. Final verdict

Buildable as a focused MVP, based on the reported existing Stage-5 foundation and the documented protocol mechanisms. Neither new adapter nor the browser flow is claimed implemented here.

The right scope is not "everything in the old product plan" and not "a pretty direct-transfer demo." It is a real owner-controlled agent payment product with two independent sponsor settlement integrations, a moderate UI and one optional fee innovation.

Restore Aqua because the selected sponsor goal requires it. Keep v4 exact-output settlement; do not require a subsidy hook merely to claim Uniswap integration. Increase UI around policy ownership, approval and verifiable receipts. Cut extra platforms and the unproven serial protocol composition.

A working one-route product is a legitimate fallback. A two-sponsor submission is ready only when both routes actually run and the team's eligibility is confirmed.

## Execution files

Use [backend prompts](PAYGUARD_BACKEND_PROMPTS.md), [frontend prompts](PAYGUARD_FRONTEND_PROMPTS.md), the [shared workflow](PAYGUARD_AGENT_WORKFLOW.md), [integration decisions](PAYGUARD_INTEGRATION_BOUNDARY.md), [UI scope](PAYGUARD_FRONTEND_SCOPE.md) and [acceptance plan](PAYGUARD_ACCEPTANCE_AND_DEMO.md). The [release prompt](PAYGUARD_RELEASE_PROMPT.md) closes the combined product. These documents do not replace historical evidence or existing API/ABI/migration files without review.

## Sources

- Input A: `Pasted markdown(8).md`, the expanded UI proposal. Treated as a proposal, not runtime evidence.
- Input B: `Pasted markdown (2)(2).md`, the scope-reduction proposal. Treated as a proposal, not runtime evidence.
- Implementation: `STAGE5_FRONTEND_BACKEND_INTEGRATION_AUDIT.md`, especially sections 0, 2, 5-12 and 16-18.
- Architecture: `03_REBUILT_ARCHITECTURE.md`, policy immutability, actor roles, fixed routes and separate settlement adapters.
- [S1]-[S5]: `SPONSOR_VERIFICATION_2026-09-14.md`, containing session-retrieved official URLs and scope boundaries.

This is a product and implementation-scope recommendation. It is not a fresh code audit, deployment record, test result or organizer approval.
