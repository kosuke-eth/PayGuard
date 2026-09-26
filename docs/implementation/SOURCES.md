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

Two retrievals of the same page are not counted as independent sources per contract rule; none of the above double-count a single fetch as two.
