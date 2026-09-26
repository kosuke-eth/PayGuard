// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * B4: ABI-only interoperability shim. `contracts/core-v4` (the vault, and the REAL
 * `IPayGuardSettlementAdapter`/`IPayGuardVault` interfaces) is pinned to an exact `pragma solidity
 * 0.8.26;` -- this project is pinned to the actual installed 1inch swap-vm (tag v1.0.2) and
 * 1inch aqua (tag 0.1.0) build config, `pragma solidity 0.8.30;`. An exact pragma pin cannot be imported
 * across that boundary at the source level, so this file is a field-for-field duplicate of
 * `contracts/core-v4/src/interfaces/{IPayGuardSettlementAdapter,IPayGuardVault}.sol`'s relevant
 * subset (the `SettlementRequest` struct, the `SubsidyMode` enum, `ExecutionContext`,
 * `getExecutionContext()`, and `settle()`), compiled under this project's own solc.
 *
 * This is NOT a new PayGuard authority schema -- it invents no new fields, semantics, or trust
 * boundary; it exists purely so `PayGuardAquaAdapter.sol` can be typed against the SAME external
 * ABI the real vault calls, in a file this project's compiler can actually build.
 *
 * Cross-contract calls between a 0.8.26-compiled vault and a 0.8.30-compiled adapter work
 * correctly at the EVM level regardless of source-level pragma (calldata is ABI-encoded, not
 * pragma-tagged) -- the ONLY risk this shim introduces is a silent drift between the two
 * declarations. `script/check-abi-equivalence.mjs` closes that risk (run automatically as part of
 * `./scripts/payguard verify-mvp B4`, not merely a standalone manual script): it compares this shim's
 * compiled ABI, byte-for-byte, against the real interface's compiled ABI (both read from their
 * own project's `out/` directory, produced by each project's own `forge build`), for every
 * function selector, error selector, and struct/enum encoding this adapter actually uses.
 */
interface IPayGuardSettlementAdapterShim {
    enum SubsidyMode { NONE, REQUIRED, BEST_EFFORT }

    struct SettlementRequest {
        bytes32 intentHash;
        bytes32 routeId;
        address inputToken;
        address outputToken;
        address merchant;
        uint256 exactOutput;
        uint256 maxInput;
        uint48 validUntil;
        SubsidyMode subsidyMode;
        uint256 maxSubsidyAmount;
    }

    function settle(SettlementRequest calldata request)
        external returns (uint256 actualInput, uint256 outputDelivered, uint256 subsidyAmount);
}

/**
 * Shim mirror of `IPayGuardVault.getExecutionContext()`'s return type only -- the adapter reads
 * this back for the same defense-in-depth cross-check `PayGuardV4Adapter.sol` (B3) uses, never
 * to derive new authority.
 */
interface IPayGuardVaultContextShim {
    struct ExecutionContext {
        bool active;
        bytes32 intentHash;
        bytes32 policyId;
        bytes32 routeId;
        address adapter;
        address merchant;
        address inputToken;
        address outputToken;
        uint256 outputAmount;
        IPayGuardSettlementAdapterShim.SubsidyMode subsidyMode;
        uint256 maxSubsidyAmount;
    }

    function getExecutionContext() external view returns (ExecutionContext memory);
}
