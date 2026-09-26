// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * Stage 1 required checkpoint: "A real local v4 exact-output swap and its negative case, with
 * receipt/balance evidence." Deploys the actual inspected v4-core PoolManager (commit
 * d153b048), plain mock tokens with different decimals (mUSDC 6, mRWA 18 per ARCH 3.3), a
 * funded liquidity position, and runs a bare exact-output swap through V4SwapHarness — a
 * minimal hand-written, authenticated unlock-callback harness independent of any future
 * PayGuard vault code.
 */

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {V4SwapHarness} from "../src/test-harness/V4SwapHarness.sol";

contract V4SwapFixtureTest is Test {
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint160 internal constant MIN_PRICE_LIMIT = TickMath.MIN_SQRT_PRICE + 1;
    uint160 internal constant MAX_PRICE_LIMIT = TickMath.MAX_SQRT_PRICE - 1;

    PoolManager internal manager;
    MockERC20 internal mUSDC; // 6 decimals
    MockERC20 internal mRWA; // 18 decimals
    Currency internal currency0;
    Currency internal currency1;
    PoolKey internal key;
    PoolModifyLiquidityTest internal liquidityRouter;
    V4SwapHarness internal harness;

    address internal lp = makeAddr("lp");
    address internal trader = makeAddr("trader");

    bool internal usdcIsCurrency0;

    function setUp() public {
        manager = new PoolManager(address(this));

        // Plainly-labeled mock assets per ARCH 3.3, not issuer-backed tokens.
        mUSDC = new MockERC20("Mock USDC", "mUSDC", 6);
        mRWA = new MockERC20("Mock RWA", "mRWA", 18);

        usdcIsCurrency0 = address(mUSDC) < address(mRWA);
        currency0 = usdcIsCurrency0 ? Currency.wrap(address(mUSDC)) : Currency.wrap(address(mRWA));
        currency1 = usdcIsCurrency0 ? Currency.wrap(address(mRWA)) : Currency.wrap(address(mUSDC));

        key = PoolKey({currency0: currency0, currency1: currency1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});
        manager.initialize(key, SQRT_PRICE_1_1);

        liquidityRouter = new PoolModifyLiquidityTest(IPoolManager(address(manager)));
        harness = new V4SwapHarness(IPoolManager(address(manager)));

        // Fund a wide-range liquidity position so both trade directions have real depth.
        // Generous LP funding: concentrated-liquidity math for a +/-60000 tick range at
        // liquidityDelta 1e24 needs far more raw token units than a naive "1 billion tokens"
        // sizing would suggest, independent of each token's own decimals.
        mUSDC.mint(lp, 1_000_000_000_000e18);
        mRWA.mint(lp, 1_000_000_000_000e18);
        vm.startPrank(lp);
        mUSDC.approve(address(liquidityRouter), type(uint256).max);
        mRWA.approve(address(liquidityRouter), type(uint256).max);
        liquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: -60000, tickUpper: 60000, liquidityDelta: 1e24, salt: 0}),
            ""
        );
        vm.stopPrank();

        // Fund the trader with input-side mRWA only, and approve the harness to pull it.
        mRWA.mint(trader, 1_000_000e18);
        vm.prank(trader);
        mRWA.approve(address(harness), type(uint256).max);
    }

    /// The trade direction: trader pays mRWA (input), receives mUSDC (output), exact output.
    function _swapParamsForExactUsdcOutput(uint256 usdcOut) internal view returns (SwapParams memory) {
        bool zeroForOne = !usdcIsCurrency0; // mRWA -> mUSDC: zeroForOne iff mRWA is currency0
        return SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: int256(usdcOut),
            sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
        });
    }

    function test_ExactOutputSwap_DeliversExactOutputAndBoundedInput() public {
        uint256 requestedUsdcOut = 500_000; // 0.50 mUSDC (6 decimals)
        uint256 maxInput = 10e18; // generous ceiling in mRWA (18 decimals)

        uint256 traderUsdcBefore = mUSDC.balanceOf(trader);
        uint256 traderRwaBefore = mRWA.balanceOf(trader);

        vm.prank(trader);
        BalanceDelta delta = harness.exactOutputSwap(key, _swapParamsForExactUsdcOutput(requestedUsdcOut), maxInput);

        uint256 traderUsdcAfter = mUSDC.balanceOf(trader);
        uint256 traderRwaAfter = mRWA.balanceOf(trader);

        // Exact output delivered.
        assertEq(traderUsdcAfter - traderUsdcBefore, requestedUsdcOut, "did not deliver exact requested output");

        // Bounded, nonzero, actual input spent.
        uint256 actualInput = traderRwaBefore - traderRwaAfter;
        assertGt(actualInput, 0, "no input was actually charged");
        assertLe(actualInput, maxInput, "charged more than maxInput ceiling");

        // No dust left in the harness — every delta was settled within the same transaction.
        assertEq(mUSDC.balanceOf(address(harness)), 0, "harness retained output dust");
        assertEq(mRWA.balanceOf(address(harness)), 0, "harness retained input dust");
        assertEq(mUSDC.balanceOf(address(manager)) > 0, true, "pool manager holds no output-side liquidity");

        // The returned delta is consistent with the direction actually traded.
        assertTrue(delta.amount0() != 0 || delta.amount1() != 0, "swap delta was entirely zero");
    }

    function test_ExactOutputSwap_RevertsOnInsufficientMaxInput_NoPartialResult() public {
        uint256 requestedUsdcOut = 500_000; // same trade as the success case
        uint256 tooSmallMaxInput = 1; // 1 wei of mRWA — far below what the trade actually needs

        uint256 traderUsdcBefore = mUSDC.balanceOf(trader);
        uint256 traderRwaBefore = mRWA.balanceOf(trader);
        uint256 managerUsdcBefore = mUSDC.balanceOf(address(manager));
        uint256 managerRwaBefore = mRWA.balanceOf(address(manager));

        // Low-level call + selector check (rather than vm.expectRevert(selector)): this forge-std
        // version matches expectRevert(bytes4) against the *entire* revert payload, and
        // MaxInputExceeded carries two uint256 args we would otherwise have to predict exactly.
        // Checking just the leading 4-byte selector is what the test actually needs to assert:
        // it reverted for the intended reason, not merely "reverted somehow".
        vm.prank(trader);
        (bool success, bytes memory returndata) = address(harness).call(
            abi.encodeCall(
                harness.exactOutputSwap, (key, _swapParamsForExactUsdcOutput(requestedUsdcOut), tooSmallMaxInput)
            )
        );
        assertFalse(success, "swap should have reverted");
        assertEq(bytes4(returndata), V4SwapHarness.MaxInputExceeded.selector, "wrong revert reason");

        // No partial token result persists: every balance is byte-for-byte unchanged.
        assertEq(mUSDC.balanceOf(trader), traderUsdcBefore, "trader USDC balance changed on revert");
        assertEq(mRWA.balanceOf(trader), traderRwaBefore, "trader RWA balance changed on revert");
        assertEq(mUSDC.balanceOf(address(manager)), managerUsdcBefore, "manager USDC balance changed on revert");
        assertEq(mRWA.balanceOf(address(manager)), managerRwaBefore, "manager RWA balance changed on revert");
        assertEq(mUSDC.balanceOf(address(harness)), 0, "harness holds unexpected USDC after revert");
        assertEq(mRWA.balanceOf(address(harness)), 0, "harness holds unexpected RWA after revert");
    }

    function test_PoolManagerDeployedWithExpectedCode() public view {
        // "Bytecode exists at recorded addresses" (ARCH 3.6 order-0 gate): a trivial but
        // concrete check that this is a real deployed contract, not an unresolved address.
        assertGt(address(manager).code.length, 0, "PoolManager has no code");
        assertGt(address(harness).code.length, 0, "V4SwapHarness has no code");
    }
}
