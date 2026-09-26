// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * B4: one fixed-maker, fixed-strategy 1inch Aqua/SwapVM taker-side settlement adapter, bound to
 * exactly ONE `PayGuardVault` (via the ABI-only shim, see `interfaces/IPayGuardSettlementAdapterShim.sol`),
 * ONE Aqua maker, and ONE shipped SwapVM strategy (order maker/traits/data, hashed once at
 * construction) -- all immutable. Real installed 1inch swap-vm (tag v1.0.2) plus 1inch aqua
 * (tag 0.1.0) (see docs/implementation/SOURCES.md S07), not a quote API or a logo wrapper: the maker's
 * strategy is a genuine bounded XYCSwap (constant-product AMM) programmable liquidity position,
 * shipped with real token inventory and a real Aqua allowance (see the maker fixture,
 * `test/fixtures/AquaMakerFixture.sol`).
 *
 * Trust boundary: `settle()`'s only caller is the vault itself (via the shim ABI); the vault's
 * OWN live `getExecutionContext()` is read back and cross-checked against the request for defense
 * in depth, exactly as `PayGuardV4Adapter.sol` (B3) does. `preTransferInCallback` accepts calls
 * ONLY from the pinned SwapVM router AND only while this contract's own `settle()` call is
 * actively awaiting it -- never as a standalone entry point. No caller-suppliable value ever
 * selects a maker, router, strategy/order, token pair, or output recipient; every one of those is
 * fixed at construction. `preTransferOutCallback` is never enabled by this adapter's own taker
 * traits (`hasPreTransferOutCallback: false`) and unconditionally reverts if somehow invoked
 * anyway -- a defensive stance against a malicious/compromised router, never a code path this
 * adapter relies on.
 */

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { ITakerCallbacks } from "@1inch/swap-vm/src/interfaces/ITakerCallbacks.sol";
import { MakerTraits } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { AquaSwapVMRouter } from "@1inch/swap-vm/src/routers/AquaSwapVMRouter.sol";

import { IPayGuardSettlementAdapterShim, IPayGuardVaultContextShim } from "./interfaces/IPayGuardSettlementAdapterShim.sol";

contract PayGuardAquaAdapter is IPayGuardSettlementAdapterShim, ITakerCallbacks, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev A fixed, deployment-independent identity for "the Aqua/SwapVM maker-liquidation
    /// route" as a class -- parallels `PayGuardVault.DIRECT_ROUTE_ID` and
    /// `PayGuardV4Adapter.ROUTE_ID`'s own well-known-constant pattern (B3).
    bytes32 public constant ROUTE_ID = keccak256("PAYGUARD_AQUA_SWAPVM_MAKER_LIQUIDATION_V1");

    IAqua public immutable aqua;
    AquaSwapVMRouter public immutable router;
    address public immutable vault;

    address public immutable orderMaker;
    MakerTraits public immutable orderTraits;
    bytes32 public immutable orderHash;
    address public immutable inputToken;
    address public immutable outputToken;

    /// @dev The shipped strategy's program+hook bytecode, set once at construction from the
    /// maker's actual shipped order, never mutated -- no setter exists. Solidity has no
    /// `immutable bytes`, so this is enforced by omission, not by a language keyword.
    bytes private _orderData;

    /// True only for the duration of one `settle()` call's own `router.swap()` -- mirrors
    /// `PayGuardV4Adapter._awaitingCallback` (B3): `preTransferInCallback` does real work only
    /// while this is true, so it can never be driven as a standalone entry point even by the
    /// real pinned router.
    bool private _awaitingCallback;
    uint256 private _activeMaxInput;

    error NotVault();
    error NotRouter();
    error NoActiveCallback();
    error ContextMismatch();
    error WrongRoute();
    error UnsupportedTokens();
    error SubsidyNotSupported();
    error InvalidAmount();
    error DeadlineOverflow();
    error PreTransferOutCallbackNotSupported();
    error WrongMakerOrOrder(address maker, bytes32 gotOrderHash);
    error MaxInputExceededAtCallback(uint256 amountIn, uint256 max);

    constructor(
        IAqua _aqua,
        AquaSwapVMRouter _router,
        address _vault,
        address _orderMaker,
        MakerTraits _orderTraits,
        bytes memory _orderDataInit,
        address _inputToken,
        address _outputToken
    ) {
        if (address(_aqua) == address(0) || address(_router) == address(0) || _vault == address(0)) revert InvalidAmount();
        if (_orderMaker == address(0) || _inputToken == address(0) || _outputToken == address(0)) revert InvalidAmount();
        if (_inputToken == _outputToken) revert UnsupportedTokens();

        aqua = _aqua;
        router = _router;
        vault = _vault;
        orderMaker = _orderMaker;
        orderTraits = _orderTraits;
        _orderData = _orderDataInit;
        inputToken = _inputToken;
        outputToken = _outputToken;

        // Pin the strategy identity itself, not just its inputs -- `router.hash()` on the real
        // pinned SwapVM router is `keccak256(abi.encode(order))` for Aqua-mode orders (confirmed
        // directly from the installed source, SOURCES.md S07), so this is the SAME identity Aqua
        // itself keys the maker's shipped balances under.
        orderHash = _router.hash(ISwapVM.Order({ maker: _orderMaker, traits: _orderTraits, data: _orderDataInit }));
    }

    function _order() private view returns (ISwapVM.Order memory) {
        return ISwapVM.Order({ maker: orderMaker, traits: orderTraits, data: _orderData });
    }

    /// @inheritdoc IPayGuardSettlementAdapterShim
    function settle(SettlementRequest calldata request)
        external
        nonReentrant
        returns (uint256 actualInput, uint256 outputDelivered, uint256 subsidyAmount)
    {
        if (msg.sender != vault) revert NotVault();
        if (request.routeId != ROUTE_ID) revert WrongRoute();
        if (request.subsidyMode != SubsidyMode.NONE || request.maxSubsidyAmount != 0) revert SubsidyNotSupported();
        if (request.exactOutput == 0 || request.maxInput == 0) revert InvalidAmount();
        if (block.timestamp > request.validUntil) revert InvalidAmount();
        if (request.inputToken != inputToken || request.outputToken != outputToken) revert UnsupportedTokens();
        // TakerTraits' own deadline field is uint40 (SOURCES.md S07); SettlementRequest.validUntil
        // is uint48 -- bound the cast explicitly rather than silently truncating a too-far future
        // expiry into a NEAR one (which would be a real, exploitable weakening of the taker's own
        // deadline protection, not merely a display bug).
        if (request.validUntil > type(uint40).max) revert DeadlineOverflow();

        // Defense in depth beyond `msg.sender == vault`: the vault's OWN live execution context
        // must agree this call is happening for exactly this adapter/intent/route/tokens/amount --
        // identical pattern to `PayGuardV4Adapter.sol` (B3).
        IPayGuardVaultContextShim.ExecutionContext memory ctx = IPayGuardVaultContextShim(vault).getExecutionContext();
        if (
            !ctx.active || ctx.adapter != address(this) || ctx.intentHash != request.intentHash
                || ctx.routeId != request.routeId || ctx.inputToken != request.inputToken
                || ctx.outputToken != request.outputToken || ctx.outputAmount != request.exactOutput
        ) {
            revert ContextMismatch();
        }

        bytes memory takerData = TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: address(this),
            isExactIn: false,
            shouldUnwrapWeth: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: false,
            useTransferFromAndAquaPush: false,
            threshold: abi.encodePacked(request.maxInput),
            to: vault,
            deadline: uint40(request.validUntil),
            hasPreTransferInCallback: true,
            hasPreTransferOutCallback: false,
            preTransferInHookData: "",
            postTransferInHookData: "",
            preTransferOutHookData: "",
            postTransferOutHookData: "",
            preTransferInCallbackData: "",
            preTransferOutCallbackData: "",
            instructionsArgs: "",
            signature: ""
        }));

        _awaitingCallback = true;
        _activeMaxInput = request.maxInput;
        (actualInput, outputDelivered, ) = router.swap(_order(), inputToken, outputToken, request.exactOutput, takerData);
        // Cleared here too (not only on entry to the callback) so a call that reverted before
        // ever reaching the callback still leaves this false.
        _awaitingCallback = false;
        _activeMaxInput = 0;

        subsidyAmount = 0;
    }

    /// @inheritdoc ITakerCallbacks
    function preTransferInCallback(
        address maker,
        address /* taker */,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 /* amountOut */,
        bytes32 gotOrderHash,
        bytes calldata /* takerData */
    ) external {
        if (msg.sender != address(router)) revert NotRouter();
        if (!_awaitingCallback) revert NoActiveCallback();
        _awaitingCallback = false;

        if (maker != orderMaker || gotOrderHash != orderHash) revert WrongMakerOrOrder(maker, gotOrderHash);
        if (tokenIn != inputToken || tokenOut != outputToken) revert UnsupportedTokens();
        // Redundant with `TakerTraitsLib.validate`'s own max-input-threshold check (already run
        // by the router before this callback fires) -- kept as explicit defense in depth, same
        // belt-and-suspenders posture as `PayGuardV4Adapter`'s own MaxInputExceeded check.
        if (amountIn > _activeMaxInput) revert MaxInputExceededAtCallback(amountIn, _activeMaxInput);

        // Pull the ACTUAL computed input (never the caller's maxInput bound) directly from the
        // vault, which pre-approved this adapter for exactly that call's maxInput -- nothing is
        // ever prefunded or left custodied by this adapter itself.
        IERC20(tokenIn).safeTransferFrom(vault, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(aqua), amountIn);
        aqua.push(maker, address(router), gotOrderHash, tokenIn, amountIn);
        // `Aqua.push` pulls exactly `amountIn` via `transferFrom(address(this), maker, amountIn)`
        // -- the approval above is fully consumed by that same call; zeroed explicitly regardless
        // so no residual allowance to Aqua ever survives this adapter's own call frame.
        IERC20(tokenIn).forceApprove(address(aqua), 0);
    }

    /// @inheritdoc ITakerCallbacks
    function preTransferOutCallback(
        address /* maker */,
        address /* taker */,
        address /* tokenIn */,
        address /* tokenOut */,
        uint256 /* amountIn */,
        uint256 /* amountOut */,
        bytes32 /* orderHash */,
        bytes calldata /* takerData */
    ) external pure {
        // This adapter's own taker traits never set `hasPreTransferOutCallback`, so the real
        // pinned router should never call this. Revert unconditionally rather than silently
        // succeeding -- a call reaching here at all means the router/traits encoding diverged
        // from what this adapter actually requested.
        revert PreTransferOutCallbackNotSupported();
    }
}
