# PayGuard targeted technical evidence

Material findings only, per shared execution contract section B. Bound to exact version/commit under test.

## S01: viem 2.56.3 vs 2.56.4

**Question:** Which viem version is actually published and installable?
**Locator:** `https://registry.npmjs.org/viem/2.56.3`, `https://registry.npmjs.org/viem/latest`
**Retrieved:** 2026-09-12 (during Stage 1, via `npm view viem@2.56.3 version`)
**Conclusion:** `2.56.3` is published and resolves; matches ARCH's already-resolved conflict note (repo `main` branch advertised `2.56.4` but that exact npm version 404'd). Confirmed independently at Stage 1 via `npm view`.
**Affected code:** root `package.json` viem pin.
**Validation:** `npm view viem@2.56.3 version` exit 0, printed `2.56.3`.

## S02: Foundry stable release matching ARCH's `v1.8.1` candidate

**Question:** Does `foundryup` install a version compatible with ARCH's pinned `v1.8.1`?
**Locator:** `https://foundry.paradigm.xyz` (installer), local `forge --version`
**Retrieved:** 2026-09-12
**Conclusion:** `foundryup`'s current stable install resolved to exactly `1.8.1` (commit `982849d3140c01fd3b72905759581a132df7aa98`, built 2026-08-28). Matches ARCH candidate exactly — no override needed.
**Affected code:** none (tool version, recorded in `DEPENDENCIES.md`).
**Validation:** `forge --version`, `anvil --version`, `cast --version` all report `1.8.1` with the same commit.

## S03: PostgreSQL 17.11 availability via Homebrew

**Question:** Is PostgreSQL 17.11 (ARCH candidate) actually installable locally without Docker (Docker daemon was not running)?
**Locator:** Homebrew formula `postgresql@17`
**Retrieved:** 2026-09-12
**Conclusion:** `brew install postgresql@17` installed exactly `17.11`. Exact match to ARCH's pinned patch version, no deviation.
**Affected code:** `docs/implementation/DEPENDENCIES.md`, local dev DB start scripts in `./scripts/payguard`.
**Validation:** `psql --version` -> `psql (PostgreSQL) 17.11 (Homebrew)`.

## S04: Uniswap v4-core inspected revision `d153b048`

**Question:** Does the pinned commit `d153b048` exist and match the ARCH-described `PoolManager`/build config (`0.8.26`, Cancun)?
**Locator:** `https://github.com/Uniswap/v4-core/blob/d153b048/foundry.toml`, `https://github.com/Uniswap/v4-core/blob/d153b048/src/PoolManager.sol` (ARCH's own `[V4_BUILD_PIN]`/`[V4_MANAGER_PIN]` citations)
**Retrieved:** re-verified during Stage 1 via `forge install` against this exact ref (see checkpoint 01 for the resolved full commit hash actually fetched).
**Conclusion:** Confirmed. `forge install --no-commit Uniswap/v4-core@d153b048` resolved to full commit `d153b048868a60c2403a3ef5b2301bb247884d46` (tag proximity `v4.0.0-19-gd153b048`), registered as a proper git submodule (see `.gitmodules`). Its own `foundry.toml` declares `solc = "0.8.26"`, `evm_version = "cancun"` — matches ARCH exactly, no override needed. `forge-std` was also registered as a proper submodule (initially installed as loose untracked files by `forge init --no-git`, which was a reproducibility gap since a fresh clone without `git submodule update --init --recursive` would have been missing it — fixed via `git submodule add`).
**Affected code:** `contracts/core-v4/lib/v4-core`, `contracts/core-v4/lib/forge-std`, `contracts/core-v4/foundry.toml`, `.gitmodules`.
**Validation:** `git submodule status --recursive` shows all 9 submodules (v4-core + forge-std + v4-core's own nested forge-std/openzeppelin-contracts/solmate/erc4626-tests/ds-test) pinned at exact commits; `forge build` exit 0 with `Compiling 76 files with Solc 0.8.26` / `Solc 0.8.26 finished`; `forge test` exit 0, 11/11 tests pass (see docs/implementation/evidence/verify-stage-01.log).

## S05: EIP-712 domain/type-hash construction (`keccak256("EIP712Domain(...)")`, struct hashes)

**Question:** Exact ABI encoding rule for EIP-712 struct hashes, used to build the independent TypeScript encoder that must match the Solidity `hashInvoice`/`hashIntent`/`hashApproval` helpers.
**Locator:** `https://eips.ethereum.org/EIPS/eip-712` (ARCH's own `[EIP712]` citation, already in every source document read at Stage 1)
**Retrieved:** re-read during Stage 1 schema work (see `packages/domain` implementation notes).
**Conclusion:** struct hash = `keccak256(typeHash || encodeData(struct))` where `encodeData` ABI-encodes each field in declaration order (dynamic types like `bytes`/`string` are themselves keccak256'd first; `PolicyConfig`/`Invoice`/`PaymentIntent`/`ExceptionApproval` here contain no dynamic fields per `reference/CONTRACT_INTERFACE.sol`, only fixed-width scalars, so no nested-hash step is needed for these four types). Domain separator uses the fixed `EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)` type.
**Affected code:** `packages/domain/src/eip712.ts`, `contracts/core-v4/test/Eip712Vectors.t.sol`.
**Validation:** confirmed. All 8 cross-language vector tests pass in `contracts/core-v4/test/Eip712Vectors.t.sol`: 3 base digests (invoice/intent/approval) match `docs/implementation/evidence/eip712-vectors.json`'s TS-computed values exactly, and 5 negative cases (changed invoice amount, changed approval nonce, wrong chainId, wrong verifyingContract, plus a same-fixture cross-check of the TS-side negative vectors) all confirm divergence as expected. Neither side imports the other's hashing code (packages/domain/src/eip712.ts uses viem's `hashTypedData`; contracts/core-v4/src/test-harness/Eip712HashHarness.sol hand-rolls `keccak256(abi.encode(...))` directly from the EIP-712 spec), so agreement is genuine cross-implementation evidence, not a shared-bug false positive.

## S06 (B3): exact-output sign convention, `unlockCallback` authentication, and settle/take/sync sequence -- verified against the ACTUAL pinned v4-core source, not a fresh doc fetch

**Question:** For `PayGuardV4Adapter.sol` (B3's real settlement adapter): does positive `SwapParams.amountSpecified` mean exact-output (not exact-input)? Does `unlockCallback` genuinely see `msg.sender == address(poolManager))`? Are `sync`/`take`/`settle` signatures and call order what `V4SwapHarness.sol` (Stage 1) already assumes?

**Locator:** the ACTUAL installed submodule at the pinned commit (S04): `contracts/core-v4/lib/v4-core/src/types/PoolOperation.sol`, `contracts/core-v4/lib/v4-core/src/libraries/Pool.sol`, `contracts/core-v4/lib/v4-core/src/PoolManager.sol`, `contracts/core-v4/lib/v4-core/src/interfaces/IPoolManager.sol`.

**Retrieved:** read directly from the pinned submodule on disk this session (B3) -- stronger evidence than an external doc fetch for "does the EXACT installed revision behave this way," since it is the literal code that will execute, not a description of some revision that may have since diverged (the "Do not upgrade moving main or import example code from a different revision without checking it" instruction this gate was given).

**Conclusion:** Confirmed on all three points.
1. `PoolOperation.sol:23`'s own doc comment: *"The desired input amount if negative (exactIn), or the desired output amount if positive (exactOut)."* -- positive `amountSpecified` is exact-output. `Pool.sol:313,371` branch on `params.amountSpecified > 0` for the exact-output code path internally, confirming the doc comment matches the actual executed branch, not just a stale comment.
2. `PoolManager.sol`'s `unlock()` (`interfaces/IPoolManager.sol:114`) invokes `IUnlockCallback(msg.sender).unlockCallback(data)` -- the callback recipient is literally `msg.sender` of the `unlock()` call, so `unlockCallback`'s own `msg.sender` during that invocation is genuinely `address(poolManager)`. `V4SwapHarness.sol`'s existing `msg.sender != address(manager)` check (and `PayGuardV4Adapter.sol`'s identical check) is authenticating against a real, structurally-guaranteed property, not an assumption.
3. `sync`/`take`/`settle` signatures at `IPoolManager.sol:171,179,183` match exactly what `V4SwapHarness.sol` (Stage 1) and the new `PayGuardV4Adapter.sol` (B3) both call, in the same sync -> transfer -> settle -> take order.

No discrepancy found between the Stage 1 fixture's existing mechanics and the pinned source -- B3 reused them rather than reinventing, per the ENTRY instruction not to "call a test adapter a real v4 integration" (the fixture's mechanics are real; what B3 adds beyond the fixture is caller/context binding, `SafeERC20`, and an exact-output-delivered check the fixture itself never needed, since Stage 1's own checkpoint only required a bare protocol success/failure pair, not a production settlement adapter).

**Affected code:** `contracts/core-v4/src/adapters/PayGuardV4Adapter.sol` (new).

**Validation:** `contracts/core-v4/test/PayGuardV4Adapter.t.sol` (new, 12 tests, real `PoolManager`) exercises exactly the behaviors this entry confirms: exact-output delivery, callback authentication (wrong-caller and no-active-callback rejections), and the sync/transfer/settle/take sequence producing zero adapter residue -- all passing against the real pinned protocol, not a mock.

## S07 (B4): actual 1inch swap-vm/Aqua release graph, taker exact-output/max-input threshold semantics, and Aqua's real (non-custodial) allowance/push/pull accounting -- verified against the ACTUAL cloned source, not the prior review's stale reference

**Question:** Which 1inch swap-vm/Aqua tags are actually installable and current (the prior review's own S51/S52/S77 notes explicitly flag the earlier `v1.0.2`/Solidity 0.8.30 reference as unverified and require B4 to re-retrieve)? Does exact-output taker mode genuinely use a max-input threshold (not merely a min-output one)? Does Aqua custody tokens, or only account for allowances?

**Locator:** `https://api.github.com/repos/1inch/swap-vm/tags` (git tag listing, live retrieval); the ACTUAL cloned repositories at the resolved commits: `contracts/aqua/lib/swap-vm` (`1inch/swap-vm`), `contracts/aqua/lib/aqua` (`1inch/aqua`), `contracts/aqua/lib/solidity-utils` (`1inch/solidity-utils`), `contracts/aqua/lib/openzeppelin-contracts`, `contracts/aqua/lib/forge-std` -- all installed via `forge install <org>/<repo>@<tag>` (same mechanism as `contracts/core-v4`'s own v4-core install, S04), never a stale SDK default or an unpinned `main` branch.

**Retrieved:** this session (B4). `git ls-remote --tags` / the GitHub tags API confirmed `v1.0.2` is genuinely the LATEST swap-vm tag (not merely the prior review's guess) and resolves to commit `32c687c2b73101fc26549e48fa1ff8a4d73afbac`. `1inch/aqua@0.1.0` resolves to `b51f3b6e3c02fa5208e1429f0f14706b025d9dd6`. `1inch/solidity-utils@6.9.7` (no `v` prefix on this repo's tags, confirmed via `git ls-remote`) resolves to `29043f22422fde454951e9733129cce5d67e6a39`. `openzeppelin-contracts@v5.4.0` resolves to `c64a1edb67b6e3f4a15cca8909c9482ad33a02b0`. `forge-std@v1.11.0` resolves to `8e40513d678f392f398620b3ef2b418648b33e89`. Every one of these matches swap-vm's own `package.json` `dependencies` block exactly (read directly from the cloned repo, not assumed).

**Conclusion:**
1. Both `swap-vm` and `aqua` pin `solc = 0.8.30`, `via_ir = true`, with a SPECIFIC non-default `optimizer_details.yulDetails.optimizerSteps` string (both projects' own `foundry.toml`, byte-identical between the two) -- confirmed necessary, not optional: `contracts/aqua`'s own build failed with a stack-too-deep error in `TakerTraits.sol` under plain `via_ir=true` without this exact optimizer_details block, only resolved by copying it verbatim.
2. `TakerTraitsLib.Args.isExactIn: false` + `threshold: abi.encodePacked(maxInput)` + `isStrictThresholdAmount: false` is genuinely a MAX-INPUT bound in min/max mode (`TakerTraitsLib.validate`, `lib/swap-vm/src/libs/TakerTraits.sol`: for `!isExactIn`, `require(amountIn <= thresholdAmount, TakerTraitsExceedingMaxInputAmount(...))`) -- confirmed directly from the pinned source, not the taker-mode README summary alone.
3. `Aqua.sol` (`lib/aqua/src/Aqua.sol`) never custodies tokens: `ship()` records bookkeeping only (a `uint248` capacity ceiling per maker/app/strategyHash/token, no `transferFrom`); `push()`/`pull()` are the ONLY functions that move real tokens, and both do so via a DIRECT `transferFrom` between the maker's own wallet and the counterparty (never through an Aqua-held balance) -- confirmed this is why "give the maker the required deliberate Aqua allowance" is a real, load-bearing requirement (the maker's wallet must hold both the real allowance to Aqua AND the real token balance at swap time, not merely at ship time).
4. A taker contract (not an EOA) settles via `ITakerCallbacks.preTransferInCallback` (called by the router immediately before the input leg), inside which it must itself call `aqua.push(maker, app, orderHash, tokenIn, amountIn)` after pulling+approving -- confirmed via the pinned project's OWN `test/mocks/MockTaker.sol`, reused as the template for `PayGuardAquaAdapter.preTransferInCallback` rather than guessed at.
5. `unlockCallback`-equivalent authentication: `msg.sender == address(router)` inside the callback is a real, structurally-guaranteed property (the router calls `ITakerCallbacks(ctx.query.taker).preTransferInCallback(...)` directly from inside its own `swap()` execution, `lib/swap-vm/src/SwapVM.sol::_transferIn`), the same class of guarantee `PayGuardV4Adapter`'s `msg.sender==poolManager` check relies on (B3, SOURCES.md S06).

No moving-main upgrade, no code imported from an unpinned revision. `docs/PAYGUARD_PACK_SOURCES.md`'s own note that "a source URL or tag in an older review is not a substitute for [re-]verification" is satisfied here by re-cloning and re-reading the actual source rather than trusting the prior citation.

**Affected code:** `contracts/aqua/` (new project entirely -- `src/PayGuardAquaAdapter.sol`, `src/interfaces/IPayGuardSettlementAdapterShim.sol`, `test/fixtures/AquaMakerFixture.sol`, `test/PayGuardAquaAdapter.t.sol`), `packages/test-utils/src/aquaVaultFixture.ts`, `apps/api/test/aquaRoute.test.ts`.

**Validation:** `contracts/aqua/test/PayGuardAquaAdapter.t.sol` (new, 12 tests, real `Aqua` + real `AquaSwapVMRouter` + a real shipped XYCSwap maker strategy) exercises exactly the behaviors this entry confirms: exact-output delivery via the real XYCSwap curve, max-input threshold enforcement (both the router's own and the adapter's redundant check), callback authentication (wrong-caller and no-active-callback rejections), non-custodial settlement (zero adapter residue on both legs, confirmed via real measured token balances), and a docked/insufficient-inventory strategy failing atomically -- all passing against the real pinned protocol, not a mock. `contracts/aqua/script/check-abi-equivalence.mjs` additionally proves the ABI-only shim this project's own 0.8.30 compiler produces is byte-structurally identical to the REAL `contracts/core-v4` 0.8.26 interfaces it stands in for.

Two retrievals of the same page are not counted as independent sources per contract rule; none of the above double-count a single fetch as two.
