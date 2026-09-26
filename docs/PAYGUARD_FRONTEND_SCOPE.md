# PayGuard frontend scope: reuse, integrate, improve

Version 2.0. This is a behavioral brief, not a pixel-perfect redesign. Keep the colleague's visual language and useful components from freshly inspected main. The audit's `web/src/{App.jsx,panels.jsx,pipeline.jsx,api.js}` locations are starting clues, not a guarantee of today's structure.

## 1. Scope and freedom

Deliver four principal pages (Overview, Policies, Approvals, Activity), one Demo/Agent workspace, and shared Vault and Receipt panels. Existing tabs can represent these without installing a router. A separate settlement page is fine if it reuses the receipt view rather than duplicating its logic. Adapt navigation to the imported app.

Do not migrate all JavaScript to TypeScript, switch frameworks, redesign every component, add a large UI kit, or install a query library solely because the earlier audit mentioned it. Use a shared typed/validated boundary and exact amount handling regardless of component language. Reuse an existing query layer if present; otherwise simple keyed polling is sufficient when implemented correctly.

The frontend is a client of real resources, not a payment authority. Remove the old simulator from the normal runtime. Historical examples may remain archived, but live pages cannot fall back to fake state when the API fails.

## 2. Navigation and shared shell

Show connected owner, chain/environment and deployment readiness. Display a clear LOCAL DEMO/mock-assets label. A disconnected wallet, expired session, wrong chain and unavailable backend should have explicit useful states, not a blank page or fictional balances.

Do not show private RPC URLs. Public config comes from `/v1/config`; owner vault discovery is authenticated. Wallet-provider project IDs, if needed, belong in documented frontend configuration, not backend authority.

## 3. Overview

Show actual supported-token balances per vault; selected agent/profile and policy; remaining total/epoch output budget; distinct input-asset limits; pending approvals; and recent durable activity.

Do not add a portfolio USD valuation. mUSDC is a mock token with token-denominated amounts, not a dollar balance guarantee. Do not sum mRWA atoms and mUSDC atoms or aggregate independent policy budgets into one displayed cap.

Counters must use complete authorized query results or be labeled "in loaded activity". Avoid analytics endpoints unless a small existing query really needs exposing. Clicking a payment opens the shared receipt.

## 4. Policies

Use ordinary labels such as total payment budget, automatic-payment limit, approval ceiling, permitted merchants/categories, input asset, settlement asset and valid-until. Advanced details expose hard input budget, maximum input per payment, fixed route, agent address and actual policy ID.

Friendly amount entry is a string converted exactly with token decimals. Validate precision and bounds. Categories map to known configured IDs; the UI does not invent trusted credentials from free text.

A saved draft is not active authority. Present preparation, wallet review, transaction submitted, observation pending, and active policy as different steps. Owner account/chain changes invalidate preparation.

Label changing an active policy as "Replace policy" where the implementation supersedes it. Explain new authority and policy-local counters. A route change creates a new policy, not a silent route toggle on old signatures. Show old payments with their original policy, not the current one.

Revoke/pause require actual owner transactions. A backend session logout is not agent revocation. Funding and policy actions must wait for real receipt/observation before completion copy.

## 5. Approvals

Load durable awaiting-approval payments. Show exact recipient, output token/amount, input token and signed maximum input, fixed route, policy, reason, expiry and the one-rule exception scope.

Fetch the exact owner typed-data payload; verify expected account/domain and decode the important fields for review. Sign through the browser wallet, POST the signature, then submit/poll the unchanged stored intent. Never replace recipient/amount/route during approval.

"Not now" can close a card without claiming rejection/cancellation. A signed approval is cancelled only through the real cancellation transaction if that control is exposed. Disable repeated action while it is pending and handle wallet rejection without retrying a signature automatically.

No fake World ID or proof-of-human badge. "Owner signed" is sufficient and must be evidenced. A capacity change after approval can still cause execution failure; explain the actual result without implying the approval guaranteed settlement.

## 6. Activity and receipt

Use separate decision, execution and evidence badges. Keep historical ESCALATE and its subsequent approval/settlement in the timeline. BLOCK is not necessarily a transaction failure; UNKNOWN is not BLOCK or FAILED.

Receipt normal view: merchant, exact requested/delivered amount, input spent, route, status, evidence. Advanced section: invoice/intent/policy identifiers, signed maximum, actual input, tx hash, block and canonicality. A merchant perspective can reuse the same authorized receipt without creating a new account platform.

Do not display actual input before receipt-backed settlement. Simulation estimates are labeled estimates and may become stale. A local transaction hash is copyable; do not link it to a nonexistent public explorer. Use a configured explorer only for an actual appropriate network.

Include loading, empty, pagination, stale/offline, expired and failed states. Preserve existing rows while a refresh fails but label their observation age. Do not fabricate success to finish an animation.

## 7. Demo/Agent workspace

Retain the useful theatrical runner. It chooses a named scenario and an already-authorized profile, then invokes the B2 bridge. It does not compute policy verdicts, change balances or create fake hashes.

Show roles clearly: seeded merchant issues a signed invoice; agent signs a bounded intent; PayGuard evaluates; worker submits; chain executes; merchant receipt is observed. Show only steps actually observed. Do not invent an agent chain-of-thought transcript. Deterministic runner text is labeled scripted/demo description, not live model reasoning.

Provide safe-payment, approval-required and adversarial-proposal scenarios. Add a duplicate test and route-specific failure button only when backed by a controlled actual test/run behavior. A failure button must not break the shared demo deployment invisibly.

Selecting v4 versus Aqua selects an authorized profile/policy before creating an intent. It is not a late route override. Independent policy budgets remain visibly independent. Use a different legitimate invoice for each successful route demonstration.

The merchant mini-surface can be a controlled invoice selector/issuer inside this workspace plus the receipt drawer. No merchant onboarding, account switching, public invoice signing or subsidy dashboard in the required scope.

## 8. Vault panel

Use existing prepared owner-action endpoints for finite approve/deposit, withdrawal, pause and revocation. Handle ordered transactions individually. ERC-20 approval success alone must not show a completed deposit.

Verify selected account/chain/from/to/value/calldata against the prepared request. Refresh state between steps. After an uncertain wallet response, reconcile the known submitted transaction or show unresolved state rather than blindly asking the wallet to send again.

Show supported tokens and actual units. Keep owner withdrawal available while payment execution is paused. Use existing application errors; do not catch everything as a generic "something went wrong".

## 9. Polling, reload and tests

Use stable payment/intent/operation IDs, scoped by owner and deployment. Do not use a transient WebSocket snapshot as the sole history. Poll only relevant active resources, stop on terminal state, avoid duplicate loops on navigation, and reauthorize after session/account/chain changes.

On reload, restore login deliberately through the documented session path or explicit re-login, then reload GET resources without issuing the payment again. Non-secret ID storage is allowed; storing private signing material or bearer credentials in localStorage is not.

Review actual browser screenshots at representative desktop and narrow viewport sizes. Check overflow, legibility, keyboard/focus behavior, disabled controls, clear wallet waits and stale values. Improve layout where useful, preserving recognizable design. Do not use visual polish as evidence of live payment behavior.

## 10. Definition of frontend complete

The owner can connect, fund the predeployed vault, create/replace policy, observe agent purchases, sign an exact exception, inspect results and recover after reload. Both sponsor routes are usable through the real system, or visibly unavailable until their required backend gate passes. No generic frontend requirement forces a new custody or signing architecture.

These are completion outcomes, not a requirement to implement every published API endpoint as a visible screen. Each unused endpoint should be intentionally classified, not accidentally assumed to exist.
