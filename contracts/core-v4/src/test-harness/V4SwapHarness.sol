// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * Stage 1 protocol/build-environment fixture. Deliberately independent of the future
 * PayGuardVault (Stage 2) — it proves a real local Uniswap v4 PoolManager + a hand-written,
 * authenticated unlock-callback harness can perform an exact-output swap with correct
 * settlement, not that PayGuard authorization/subsidy composition works (ARCH 3.3
 * "Keep the fixture independent of the future PayGuard kernel").
 *
 * Mechanics per ARCH 3.3 "v4 exact-output adapter" and the actual inspected IPoolManager
 * (lib/v4-core/src/interfaces/IPoolManager.sol, commit d153b048): sort currencies by address,
 * amountSpecified positive = exact output, sync(input) -> transfer -> settle() -> take(output).
 * The bounded-failure case below enforces maxInput as an application-level ceiling separate
 * from the pool's own liquidity/price-limit bounds — the same shape of check the future vault
 * applies to maxInputAmount (ARCH 3.3 atomic execution algorithm step 6).
 */

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

contract V4SwapHarness is IUnlockCallback {
    using CurrencyLibrary for Currency;

    error Unauthorized();
    error MaxInputExceeded(uint256 required, uint256 max);
    error NotExactOutput();

    IPoolManager public immutable manager;

    struct CallbackData {
        address payer;
        PoolKey key;
        SwapParams params;
        uint256 maxInput;
    }

    constructor(IPoolManager _manager) {
        manager = _manager;
    }

    /// @notice Pulls at most maxInput from msg.sender, delivers exactly the requested output to
    /// msg.sender. Reverts (and settles nothing) if the actual required input exceeds maxInput.
    function exactOutputSwap(PoolKey memory key, SwapParams memory params, uint256 maxInput)
        external
        returns (BalanceDelta delta)
    {
        if (params.amountSpecified <= 0) revert NotExactOutput();
        bytes memory result =
            manager.unlock(abi.encode(CallbackData({payer: msg.sender, key: key, params: params, maxInput: maxInput})));
        delta = abi.decode(result, (BalanceDelta));
    }

    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert Unauthorized();
        CallbackData memory data = abi.decode(rawData, (CallbackData));

        BalanceDelta delta = manager.swap(data.key, data.params, "");

        (Currency inputCurrency, Currency outputCurrency, uint256 inputOwed, uint256 outputOwed) =
            _resolveDeltas(data.key, data.params.zeroForOne, delta);

        if (inputOwed > data.maxInput) {
            revert MaxInputExceeded(inputOwed, data.maxInput);
        }

        // sync -> transfer -> settle: pay what the pool is owed for the input currency.
        manager.sync(inputCurrency);
        // Test-fixture-only: return value intentionally unchecked (MockERC20 always reverts on
        // failure rather than returning false). A real vault adapter (Stage 2) must not copy
        // this without an explicit success check / SafeERC20.
        IERC20(Currency.unwrap(inputCurrency)).transferFrom(data.payer, address(manager), inputOwed);
        manager.settle();

        // take: withdraw exactly the requested output currency straight to the payer.
        manager.take(outputCurrency, data.payer, outputOwed);

        return abi.encode(delta);
    }

    function _resolveDeltas(PoolKey memory key, bool zeroForOne, BalanceDelta delta)
        private
        pure
        returns (Currency inputCurrency, Currency outputCurrency, uint256 inputOwed, uint256 outputOwed)
    {
        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();
        if (zeroForOne) {
            inputCurrency = key.currency0;
            outputCurrency = key.currency1;
            inputOwed = amount0 < 0 ? uint256(uint128(-amount0)) : 0;
            outputOwed = amount1 > 0 ? uint256(uint128(amount1)) : 0;
        } else {
            inputCurrency = key.currency1;
            outputCurrency = key.currency0;
            inputOwed = amount1 < 0 ? uint256(uint128(-amount1)) : 0;
            outputOwed = amount0 > 0 ? uint256(uint128(amount0)) : 0;
        }
    }
}
