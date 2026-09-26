// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * Broadcasts the Stage 1 v4 swap fixture to a REAL running Anvil RPC endpoint (not forge test's
 * in-process EVM). Run against a spawned `anvil` instance, e.g.:
 *   forge script script/DeployFixture.s.sol --rpc-url http://127.0.0.1:<port> --broadcast \
 *     --private-key <anvil-dev-key>
 *
 * Deployed addresses are emitted via console2.log in a simple KEY=0x... form so an external
 * caller (packages/chain/test/v4-anvil-fixture.test.ts) can parse them from stdout without
 * depending on broadcast-artifact JSON layout.
 */

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {V4SwapHarness} from "../src/test-harness/V4SwapHarness.sol";

contract DeployFixture is Script {
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    int24 internal constant TICK_LOWER = -60000;
    int24 internal constant TICK_UPPER = 60000;
    int256 internal constant LIQUIDITY_DELTA = 1e24;
    uint256 internal constant LP_MINT_AMOUNT = 1_000_000_000_000e18;
    uint256 internal constant TRADER_RWA_MINT_AMOUNT = 1_000_000e18;

    // Anvil's well-known default dev account #0. Never used outside this local disposable
    // fixture (CLAUDE.md: no real owner/agent key ever enters build/deploy tooling).
    uint256 internal constant DEFAULT_DEPLOYER_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function run() external {
        uint256 deployerKey = vm.envOr("DEPLOYER_PRIVATE_KEY", DEFAULT_DEPLOYER_KEY);
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        PoolManager manager = new PoolManager(deployer);
        MockERC20 mUSDC = new MockERC20("Mock USDC", "mUSDC", 6);
        MockERC20 mRWA = new MockERC20("Mock RWA", "mRWA", 18);

        bool usdcIsCurrency0 = address(mUSDC) < address(mRWA);
        Currency currency0 = usdcIsCurrency0 ? Currency.wrap(address(mUSDC)) : Currency.wrap(address(mRWA));
        Currency currency1 = usdcIsCurrency0 ? Currency.wrap(address(mRWA)) : Currency.wrap(address(mUSDC));
        PoolKey memory key =
            PoolKey({currency0: currency0, currency1: currency1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});
        manager.initialize(key, SQRT_PRICE_1_1);

        PoolModifyLiquidityTest liquidityRouter = new PoolModifyLiquidityTest(IPoolManager(address(manager)));
        V4SwapHarness harness = new V4SwapHarness(IPoolManager(address(manager)));

        mUSDC.mint(deployer, LP_MINT_AMOUNT);
        mRWA.mint(deployer, LP_MINT_AMOUNT);
        mUSDC.approve(address(liquidityRouter), type(uint256).max);
        mRWA.approve(address(liquidityRouter), type(uint256).max);
        liquidityRouter.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: LIQUIDITY_DELTA, salt: 0}), ""
        );

        // The same deployer account also acts as the trader in this minimal fixture; fund it
        // with extra mRWA (input side) and pre-approve the harness to pull it.
        mRWA.mint(deployer, TRADER_RWA_MINT_AMOUNT);
        mRWA.approve(address(harness), type(uint256).max);

        vm.stopBroadcast();

        console2.log("MANAGER=", address(manager));
        console2.log("MUSDC=", address(mUSDC));
        console2.log("MRWA=", address(mRWA));
        console2.log("HARNESS=", address(harness));
        console2.log("LIQUIDITY_ROUTER=", address(liquidityRouter));
        console2.log("TRADER=", deployer);
        console2.log("USDC_IS_CURRENCY0=", usdcIsCurrency0);
    }
}
