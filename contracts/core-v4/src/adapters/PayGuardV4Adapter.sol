// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * B3: one fixed-pool, normal-fee (3000, no hook) Uniswap v4 exact-output settlement adapter,
 * bound to exactly ONE `PayGuardVault` and ONE `PoolKey` at deployment (both immutable). This is
 * the real installed Uniswap v4-core (commit d153b048, see docs/implementation/SOURCES.md) --
 * the exact-output/unlockCallback/settle/take mechanics mirror `V4SwapHarness.sol` (Stage 1's
 * protocol fixture, reused not reinvented), extended with what a real PayGuard adapter needs
 * that the harness deliberately did not: `SafeERC20` instead of an unchecked `transferFrom`
 * return, an exact-output-delivered check (a v4 swap can legally return LESS than requested if
 * a price limit or insufficient liquidity truncates it -- the harness never checked this; this
 * adapter fails the whole payment instead of ever reporting a partial merchant success), and
 * caller/context binding so this adapter can only ever be driven by the one vault it was
 * deployed for.
 *
 * Trust boundary: `IPayGuardSettlementAdapter.settle()`'s only caller is the vault itself,
 * `vault.getExecutionContext()` is read back and cross-checked against the request for defense
 * in depth, and `unlockCallback` accepts calls ONLY from the pinned `poolManager` AND only
 * while this contract's own `settle()` call is actively awaiting it -- never as a standalone
 * entry point. No caller-suppliable value ever selects a target address, function selector,
 * pool, callback program or output recipient; every one of those is fixed at construction.
 */

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

import {IPayGuardSettlementAdapter} from "../interfaces/IPayGuardSettlementAdapter.sol";
import {IPayGuardVault} from "../interfaces/IPayGuardVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PayGuardV4Adapter is IPayGuardSettlementAdapter, IUnlockCallback, ReentrancyGuard {
    using CurrencyLibrary for Currency;
    using SafeERC20 for IERC20;

    /// @dev A fixed, deployment-independent identity for "the v4 fixed-pool exact-output route"
    /// as a class -- parallels `PayGuardVault.DIRECT_ROUTE_ID`'s own well-known-constant pattern.
    /// Every fresh deployment of this adapter (a real reset, per B3 item 7) uses this SAME
    /// routeId; what changes on reset is the vault/policy identity, never this constant.
    bytes32 public constant ROUTE_ID = keccak256("PAYGUARD_V4_FIXED_POOL_EXACT_OUTPUT_V1");

    uint160 internal constant MIN_PRICE_LIMIT = TickMath.MIN_SQRT_PRICE + 1;
    uint160 internal constant MAX_PRICE_LIMIT = TickMath.MAX_SQRT_PRICE - 1;

    IPoolManager public immutable poolManager;
    address public immutable vault;
    Currency public immutable currency0;
    Currency public immutable currency1;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;
    IHooks public immutable hooks;

    /// True only for the duration of one `settle()` call's own `poolManager.unlock()` --
    /// `unlockCallback` does real work only while this is true, so it can never be driven as a
    /// standalone entry point even by the real pinned PoolManager.
    bool private _awaitingCallback;

    struct CallbackData {
        bool zeroForOne;
        int256 amountSpecified;
        uint256 maxInput;
    }

    error NotVault();
    error NotPoolManager();
    error NoActiveCallback();
    error ContextMismatch();
    error WrongRoute();
    error UnsupportedTokens();
    error SubsidyNotSupported();
    error InvalidAmount();
    error AmountOverflow();
    error Expired();
    error OutputShortfall(uint256 requested, uint256 delivered);
    error MaxInputExceeded(uint256 required, uint256 max);
    error HookNotAllowed();
    error FeeNotNormal();

    /// @dev "Normal fee" per B3 scope -- the exact fee/tickSpacing pairing this whole fixture
    /// (V4SwapFixture.t.sol, PayGuardV4Adapter.t.sol, the demo pool) is deployed and tested
    /// against. A caller picking a different pairing would silently target a DIFFERENT, never
    /// tested pool.
    uint24 internal constant NORMAL_FEE = 3000;
    int24 internal constant NORMAL_TICK_SPACING = 60;

    constructor(
        IPoolManager _poolManager,
        address _vault,
        Currency _currency0,
        Currency _currency1,
        uint24 _fee,
        int24 _tickSpacing,
        IHooks _hooks
    ) {
        if (address(_poolManager) == address(0) || _vault == address(0)) revert InvalidAmount();
        // v4 itself requires currency0 < currency1 for a valid PoolKey (`Currency.unwrap`
        // address ordering) -- checked here too so a misconfigured deployment fails fast at
        // construction rather than on the first real payment.
        if (Currency.unwrap(_currency0) >= Currency.unwrap(_currency1)) revert UnsupportedTokens();
        // The "fixed pool, no hook, normal fee" security posture this contract's own header
        // documents must be a CODE-LEVEL invariant, not a deployment-script convention: a hook
        // executes arbitrary logic inside `poolManager.swap()` (called from `unlockCallback`),
        // which every other guard in this contract implicitly assumes cannot happen.
        if (address(_hooks) != address(0)) revert HookNotAllowed();
        if (_fee != NORMAL_FEE || _tickSpacing != NORMAL_TICK_SPACING) revert FeeNotNormal();

        poolManager = _poolManager;
        vault = _vault;
        currency0 = _currency0;
        currency1 = _currency1;
        fee = _fee;
        tickSpacing = _tickSpacing;
        hooks = _hooks;
    }

    function poolKey() public view returns (PoolKey memory) {
        return PoolKey({currency0: currency0, currency1: currency1, fee: fee, tickSpacing: tickSpacing, hooks: hooks});
    }

    /// @inheritdoc IPayGuardSettlementAdapter
    function settle(SettlementRequest calldata request)
        external
        nonReentrant
        returns (uint256 actualInput, uint256 outputDelivered, uint256 subsidyAmount)
    {
        if (msg.sender != vault) revert NotVault();
        if (request.routeId != ROUTE_ID) revert WrongRoute();
        if (request.subsidyMode != IPayGuardVault.SubsidyMode.NONE || request.maxSubsidyAmount != 0) {
            revert SubsidyNotSupported();
        }
        if (request.exactOutput == 0 || request.maxInput == 0) revert InvalidAmount();
        if (block.timestamp > request.validUntil) revert Expired();
        // BalanceDelta legs are int128; fail fast with a clear reason rather than an opaque
        // downstream cast revert deep inside the pool's own accounting.
        if (request.exactOutput > uint256(uint128(type(int128).max))) revert AmountOverflow();

        bool zeroForOne = _directionFor(request.inputToken, request.outputToken);

        // Defense in depth beyond `msg.sender == vault`: the vault's OWN live execution context
        // must agree this call is happening for exactly this adapter/intent/route/tokens/amount
        // -- correlates the request with the CURRENT calling vault's own state, not merely trust
        // in an immutable address comparison.
        IPayGuardVault.ExecutionContext memory ctx = IPayGuardVault(vault).getExecutionContext();
        if (
            !ctx.active || ctx.adapter != address(this) || ctx.intentHash != request.intentHash
                || ctx.routeId != request.routeId || ctx.inputToken != request.inputToken
                || ctx.outputToken != request.outputToken || ctx.outputAmount != request.exactOutput
        ) {
            revert ContextMismatch();
        }

        _awaitingCallback = true;
        bytes memory result = poolManager.unlock(
            abi.encode(CallbackData({zeroForOne: zeroForOne, amountSpecified: int256(request.exactOutput), maxInput: request.maxInput}))
        );
        // `unlockCallback` clears this itself on entry; cleared again here so a call that
        // reverted mid-unlock (and thus never reached the callback) still leaves it false.
        _awaitingCallback = false;

        (actualInput, outputDelivered) = abi.decode(result, (uint256, uint256));
        subsidyAmount = 0;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        if (!_awaitingCallback) revert NoActiveCallback();
        _awaitingCallback = false;

        CallbackData memory cb = abi.decode(data, (CallbackData));

        SwapParams memory params = SwapParams({
            zeroForOne: cb.zeroForOne,
            amountSpecified: cb.amountSpecified,
            sqrtPriceLimitX96: cb.zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
        });

        BalanceDelta delta = poolManager.swap(poolKey(), params, "");
        (uint256 inputOwed, uint256 outputOwed) = _resolveDeltas(cb.zeroForOne, delta);

        // A price limit or thin liquidity can legally return LESS than the requested exact
        // output instead of reverting outright -- fail the whole payment rather than settle a
        // partial merchant result.
        if (outputOwed != uint256(cb.amountSpecified)) revert OutputShortfall(uint256(cb.amountSpecified), outputOwed);
        if (inputOwed == 0) revert InvalidAmount();
        if (inputOwed > cb.maxInput) revert MaxInputExceeded(inputOwed, cb.maxInput);

        Currency inputCurrency = cb.zeroForOne ? currency0 : currency1;
        Currency outputCurrency = cb.zeroForOne ? currency1 : currency0;

        // sync -> transfer -> settle -> take, the same sequence `V4SwapHarness` already proved
        // locally against this exact pinned PoolManager (Stage 1), with a checked ERC20 pull
        // (SafeERC20) instead of the harness's deliberately-unchecked one. `transferFrom` here
        // pulls directly from the VAULT (which approved this adapter for `maxInput` before
        // calling `settle()`) straight to the PoolManager -- this contract never custodies the
        // input token itself, so there is structurally nothing "prefunded" left on this adapter
        // to refund, and no pre-existing adapter token balance is ever read or used as a funding
        // source for this payment.
        poolManager.sync(inputCurrency);
        IERC20(Currency.unwrap(inputCurrency)).safeTransferFrom(vault, address(poolManager), inputOwed);
        poolManager.settle();

        // take: output goes straight to the calling vault, never through this adapter.
        poolManager.take(outputCurrency, vault, outputOwed);

        return abi.encode(inputOwed, outputOwed);
    }

    function _directionFor(address inputToken, address outputToken) private view returns (bool zeroForOne) {
        address c0 = Currency.unwrap(currency0);
        address c1 = Currency.unwrap(currency1);
        if (inputToken == c0 && outputToken == c1) return true;
        if (inputToken == c1 && outputToken == c0) return false;
        revert UnsupportedTokens();
    }

    function _resolveDeltas(bool zeroForOne, BalanceDelta delta)
        private
        pure
        returns (uint256 inputOwed, uint256 outputOwed)
    {
        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();
        if (zeroForOne) {
            inputOwed = amount0 < 0 ? uint256(uint128(-amount0)) : 0;
            outputOwed = amount1 > 0 ? uint256(uint128(amount1)) : 0;
        } else {
            inputOwed = amount1 < 0 ? uint256(uint128(-amount1)) : 0;
            outputOwed = amount0 > 0 ? uint256(uint128(amount0)) : 0;
        }
    }
}
