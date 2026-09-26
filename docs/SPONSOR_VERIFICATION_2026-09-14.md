# PayGuard sponsor verification notes

Checked: 2026-09-14. Event: ETHGlobal Tokyo 2026. These notes document retrieved requirements, not approval of PayGuard's eligibility or a prediction of judging outcomes.

## S1. 1inch: Build an Aqua App

Official source: https://ethglobal.com/events/tokyo2026/prizes/1inch
Cross-check: https://ethglobal.com/events/tokyo2026/prizes

Retrieved using Exa for the individual page and a fresh Firecrawl scrape (`maxAge: 0`) of the event prize page.

The published task is a custom Aqua application implementing a sophisticated DeFi position. Official contracts and a live token-transfer demonstration are required; local forks are explicitly accepted. SwapVM usage receives favorable scoring. Opcode modification is allowed, not required. Meaningful Git history is required. The page lists a $5,000 regular pool and a separate $2,000 Continuity pool. Qualification and the interpretation of sophistication remain with organizers/judges.

## S2. Uniswap Foundation: Best Uniswap Stack Contribution

Official source: https://ethglobal.com/events/tokyo2026/prizes/uniswap-foundation
Cross-check: https://ethglobal.com/events/tokyo2026/prizes

Both pages were freshly scraped with Firecrawl (`maxAge: 0`).

The task accepts building on or integrating the Uniswap stack; a custom hook is not mandatory. The published requirements include a public source repository, `FEEDBACK.md`, the developer feedback form linked to that file, and README pointers to relevant integration code. Separate regular and Continuity pools are listed at $6,000 and $4,000. These are pool totals, not one team's guaranteed prize.

Freshness conflict: Exa's individual-page retrieval returned an older "details coming soon" version. The fresh individual and aggregate Firecrawl pages agree on published requirements. The fresh versions are retained here. Generic web search also returned other events and the 2023 Tokyo page; those are not used as Tokyo 2026 prize evidence.

Feedback form: https://developers.uniswap.org/hackathon-feedback

## S3. Event rules and existing work

Official event details: https://ethglobal.com/events/tokyo2026/info/details
General rules: https://ethglobal.com/rules
Event listing: https://ethglobal.com/events

Retrieved via web; event details also freshly scraped with Firecrawl.

The event listing places Tokyo on September 25-27, 2026. Classic submissions cannot contain pre-existing project-specific work. Continuity permits an existing codebase subject to its rules, disclosure and substantive new event work. Sponsor eligibility can vary. The event requires AI-use attribution and inclusion of spec-driven prompts/planning artifacts. Its event page specifies a 2-4 minute submission video and a four-minute finalist demonstration followed by Q&A. Confirm the team's approved track directly; these public pages do not establish its registration or acceptance.

The September 14 audit reports substantial existing implementation, including uncommitted work. Preserve and disclose it accurately. Creating a new branch or committing it later does not make it new event work.

## S4. Secondary sponsors

Source: https://ethglobal.com/events/tokyo2026/prizes
Retrieval: fresh Firecrawl scrape.

World's detailed task was still unpublished in the retrieved page. ENS tasks now specify meaningful ENSv2 use on Sepolia, not cosmetic name labels. Neither is selected for the final two-sponsor MVP. Their current descriptions must not be substituted with old generic prize assumptions.

## S5. Settlement mechanisms consulted

- Uniswap callback/delta guide: https://developers.uniswap.org/docs/protocols/v4/guides/unlock-callback-and-deltas
- Inspected v4 interface: https://github.com/Uniswap/v4-core/blob/d153b048/src/interfaces/IPoolManager.sol
- Aqua routing/access: https://business.1inch.com/portal/documentation/aqua/liquidity-layer/access-resolvers-and-pathfinder
- Inspected SwapVM implementation: https://github.com/1inch/swap-vm/blob/v1.0.2/src/SwapVM.sol
- Inspected taker traits: https://github.com/1inch/swap-vm/blob/v1.0.2/src/libs/TakerTraits.sol

The Uniswap guide was retrieved through web and Context7; interfaces/source through Exa. Aqua documentation was retrieved through web and its pinned implementation through Exa. These support bounded settlement mechanisms, not an already-tested PayGuard adapter. Pin and test the actual dependency graph during implementation; do not replace project locks merely because these notes mention a revision.

Relevant boundaries: v4 requires outstanding deltas to be settled. Aqua strategy accounting is distinct from hosted routing. SwapVM has a taker-side exact-output maximum-input check and separate maker/taker transfer obligations. Neither protocol requires being chained through the other for PayGuard's proposed two-route product.

## Evidence limits

This session reviewed the supplied two scope proposals and the Stage-5 audit, then retrieved the sources above. It did not inspect the current local working tree, rerun tests, probe deployed contracts or approve sponsor eligibility. The audit is the source for reported implementation status. The final scope file contains recommendations, not newly implemented behavior.
