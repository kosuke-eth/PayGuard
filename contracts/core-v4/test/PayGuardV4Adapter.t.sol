// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * B3: real Uniswap v4 exact-output settlement through the ACTUAL PayGuardVault (not a mock
 * adapter -- `AdapterRouteTest` already proves the vault's own generic settlement-invariant
 * enforcement against a controllable test adapter; this file proves the real v4 protocol path
 * specifically). Real `PoolManager` (commit d153b048, same as `V4SwapFixture.t.sol`), real
 * `mUSDC`(6dp)/`mRWA`(18dp) mock tokens, a real seeded liquidity position, a freshly-deployed
 * vault supporting both tokens (the existing vault's `supportedTokenMap` is immutable --
 * `PayGuardVault.sol:88-95` -- so a v4 policy needs its own vault deployment, per B3 item 7),
 * and the real `PayGuardV4Adapter` bound to that vault and pool.
 */

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {PayGuardVault} from "../src/PayGuardVault.sol";
import {IPayGuardVault} from "../src/interfaces/IPayGuardVault.sol";
import {IPayGuardSettlementAdapter} from "../src/interfaces/IPayGuardSettlementAdapter.sol";
import {PayGuardV4Adapter} from "../src/adapters/PayGuardV4Adapter.sol";

contract MockVaultForContextMismatch {
    // Minimal stand-in exposing ONLY what PayGuardV4Adapter.settle() reads
    // (getExecutionContext), used solely to prove the context-correlation guard is real,
    // reachable code -- the real vault always sets a matching context, so this branch is
    // otherwise unreachable through the genuine vault path.
    function getExecutionContext() external pure returns (IPayGuardVault.ExecutionContext memory ctx) {
        // active:false alone is enough to fail the adapter's check.
    }

    function callSettle(PayGuardV4Adapter target, IPayGuardSettlementAdapter.SettlementRequest calldata request)
        external
    {
        target.settle(request);
    }
}

contract PayGuardV4AdapterTest is Test {
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    uint256 internal constant OWNER_KEY = 0xA11CE;
    uint256 internal constant AGENT_KEY = 0xA9E27;
    uint256 internal constant MERCHANT_SIGNER_KEY = 0xBEEF;

    address internal owner;
    address internal agent;
    address internal merchantSigner;
    address internal merchantRecipient = address(0xCAFE);
    bytes32 internal constant MERCHANT_ID = keccak256("v4-test-merchant");

    PoolManager internal manager;
    MockERC20 internal mUSDC; // 6 decimals, the settlement/output token
    MockERC20 internal mRWA; // 18 decimals, the input token
    Currency internal currency0;
    Currency internal currency1;
    PoolKey internal key;
    PoolModifyLiquidityTest internal liquidityRouter;
    bool internal usdcIsCurrency0;

    PayGuardVault internal vault;
    PayGuardV4Adapter internal adapter;
    bytes32 internal policyId;

    function setUp() public {
        owner = vm.addr(OWNER_KEY);
        agent = vm.addr(AGENT_KEY);
        merchantSigner = vm.addr(MERCHANT_SIGNER_KEY);

        manager = new PoolManager(address(this));
        mUSDC = new MockERC20("Mock USDC", "mUSDC", 6);
        mRWA = new MockERC20("Mock RWA", "mRWA", 18);

        usdcIsCurrency0 = address(mUSDC) < address(mRWA);
        currency0 = usdcIsCurrency0 ? Currency.wrap(address(mUSDC)) : Currency.wrap(address(mRWA));
        currency1 = usdcIsCurrency0 ? Currency.wrap(address(mRWA)) : Currency.wrap(address(mUSDC));
        key = PoolKey({currency0: currency0, currency1: currency1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});
        manager.initialize(key, SQRT_PRICE_1_1);

        liquidityRouter = new PoolModifyLiquidityTest(IPoolManager(address(manager)));
        address lp = makeAddr("lp");
        mUSDC.mint(lp, 1_000_000_000_000e18);
        mRWA.mint(lp, 1_000_000_000_000e18);
        vm.startPrank(lp);
        mUSDC.approve(address(liquidityRouter), type(uint256).max);
        mRWA.approve(address(liquidityRouter), type(uint256).max);
        liquidityRouter.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: -60000, tickUpper: 60000, liquidityDelta: 1e24, salt: 0}), ""
        );
        vm.stopPrank();

        address[] memory supported = new address[](2);
        supported[0] = address(mUSDC);
        supported[1] = address(mRWA);
        vault = new PayGuardVault(owner, supported);

        adapter = new PayGuardV4Adapter(IPoolManager(address(manager)), address(vault), currency0, currency1, 3000, 60, IHooks(address(0)));

        IPayGuardVault.PolicyConfig memory config = IPayGuardVault.PolicyConfig({
            agent: agent,
            inputToken: address(mRWA),
            settlementToken: address(mUSDC),
            adapter: address(adapter),
            routeId: adapter.ROUTE_ID(),
            totalOutputBudget: 300_000_000, // 300 mUSDC @ 6dp
            epochOutputBudget: 300_000_000,
            automaticOutputCap: 100_000_000, // 100 mUSDC
            escalationOutputCap: 200_000_000, // 200 mUSDC
            totalInputBudget: 1_000_000e18, // generous mRWA ceiling
            maxInputPerPayment: 500_000e18,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 30 days),
            allowedCategoryBitmap: type(uint256).max,
            subsidyMode: IPayGuardVault.SubsidyMode.NONE
        });
        IPayGuardVault.MerchantPermission[] memory merchants = new IPayGuardVault.MerchantPermission[](1);
        merchants[0] = IPayGuardVault.MerchantPermission({
            merchantId: MERCHANT_ID,
            recipient: merchantRecipient,
            invoiceSigner: merchantSigner,
            category: 1
        });
        vm.prank(owner);
        policyId = vault.createPolicy(config, merchants);

        // Owner deposit: the vault needs real mRWA (input token) balance to forward to the
        // adapter -- deposits go through the vault's own real deposit() path, not a test shortcut.
        mRWA.mint(owner, 1_000_000e18);
        vm.startPrank(owner);
        mRWA.approve(address(vault), type(uint256).max);
        vault.deposit(address(mRWA), 1_000_000e18);
        vm.stopPrank();
    }

    function _invoiceAndIntent(bytes32 invoiceId, uint256 outputAmount, uint256 maxInputAmount, uint256 nonce)
        internal
        view
        returns (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent)
    {
        invoice = IPayGuardVault.Invoice({
            invoiceId: invoiceId,
            merchantId: MERCHANT_ID,
            recipient: merchantRecipient,
            settlementToken: address(mUSDC),
            outputAmount: outputAmount,
            category: 1,
            validUntil: uint48(block.timestamp + 1 days)
        });
        intent = IPayGuardVault.PaymentIntent({
            policyId: policyId,
            invoiceHash: vault.hashInvoice(invoice),
            routeId: adapter.ROUTE_ID(),
            maxInputAmount: maxInputAmount,
            nonce: nonce,
            validUntil: uint48(block.timestamp + 1 hours),
            subsidyMode: IPayGuardVault.SubsidyMode.NONE,
            maxSubsidyAmount: 0
        });
    }

    function _sigs(IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent)
        internal
        view
        returns (bytes memory agentSig, bytes memory merchantSig)
    {
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(AGENT_KEY, vault.hashIntent(intent));
        agentSig = abi.encodePacked(r1, s1, v1);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(MERCHANT_SIGNER_KEY, vault.hashInvoice(invoice));
        merchantSig = abi.encodePacked(r2, s2, v2);
    }

    function _emptyApproval() internal pure returns (IPayGuardVault.ExceptionApproval memory approval, bytes memory sig) {
        approval = IPayGuardVault.ExceptionApproval({intentHash: bytes32(0), nonce: 0, validUntil: 0});
        sig = bytes("");
    }

    // ---- Happy path: bare protocol success through the real vault ----------------------------

    function test_RealV4Swap_HappyPath_DeliversExactOutput_RealMeasuredDeltas() public {
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(1)), 500_000, 50_000e18, 1); // 0.50 mUSDC out
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        // evaluate() and the real executed outcome must agree -- proves simulation isn't hardcoded
        // to the DIRECT route.
        IPayGuardVault.Evaluation memory evaluation =
            vault.evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        assertEq(uint8(evaluation.decision), uint8(IPayGuardVault.Decision.ALLOW));

        uint256 vaultRwaBefore = mRWA.balanceOf(address(vault));
        uint256 merchantUsdcBefore = mUSDC.balanceOf(merchantRecipient);

        (, uint256 actualInput,) = vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        // Real, non-hardcoded conversion result: some positive amount of mRWA was actually spent,
        // never a fixed/invented number.
        uint256 realInputSpent = vaultRwaBefore - mRWA.balanceOf(address(vault));
        assertEq(realInputSpent, actualInput);
        assertGt(actualInput, 0);
        assertLe(actualInput, 50_000e18);

        assertEq(mUSDC.balanceOf(merchantRecipient) - merchantUsdcBefore, 500_000, "merchant did not receive exact output");
        assertEq(mUSDC.balanceOf(address(adapter)), 0, "adapter retained output residue");
        assertEq(mRWA.balanceOf(address(adapter)), 0, "adapter retained input residue");
        assertEq(mRWA.allowance(address(vault), address(adapter)), 0, "residual allowance not cleared");

        IPayGuardVault.PolicyState memory state = vault.getPolicyState(policyId);
        assertEq(state.inputSpent, actualInput, "reservation not refunded down to actual usage");
        assertEq(state.outputSpent, 500_000);
    }

    // ---- Bounded failure: max-input / slippage ceiling ----------------------------------------

    function test_RealV4Swap_MaxInputExceeded_WholePaymentReverts_StateUntouched() public {
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(1)), 500_000, 1, 1); // 1 wei mRWA ceiling -- far too small
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        // The ADAPTER's own maxInput check fires first (before the vault's outer
        // SettlementInvariant delta check ever gets a chance to) -- a real, precise reason, not a
        // generic one. Low-level call + leading-selector check since MaxInputExceeded carries two
        // uint256 args we would otherwise have to predict exactly (same pattern as
        // V4SwapFixture.t.sol's own bounded-failure test).
        (bool success, bytes memory returndata) = address(vault).call(
            abi.encodeCall(vault.executePayment, (invoice, intent, agentSig, merchantSig, approval, ownerSig))
        );
        assertFalse(success, "payment should have reverted");
        assertEq(bytes4(returndata), PayGuardV4Adapter.MaxInputExceeded.selector, "wrong revert reason");

        assertFalse(vault.isInvoiceConsumed(merchantRecipient, bytes32(uint256(1))));
        assertFalse(vault.isAgentNonceUsed(agent, 1));
        IPayGuardVault.PolicyState memory state = vault.getPolicyState(policyId);
        assertEq(state.inputSpent, 0);
        assertEq(state.outputSpent, 0);
        assertEq(mRWA.allowance(address(vault), address(adapter)), 0);
    }

    // ---- Absent liquidity: a second pool/adapter with no seeded position ----------------------

    function test_RealV4Swap_AbsentLiquidity_Reverts() public {
        MockERC20 thinUSDC = new MockERC20("Thin USDC", "tUSDC", 6);
        MockERC20 thinRWA = new MockERC20("Thin RWA", "tRWA", 18);
        bool thinUsdcIsCurrency0 = address(thinUSDC) < address(thinRWA);
        Currency c0 = thinUsdcIsCurrency0 ? Currency.wrap(address(thinUSDC)) : Currency.wrap(address(thinRWA));
        Currency c1 = thinUsdcIsCurrency0 ? Currency.wrap(address(thinRWA)) : Currency.wrap(address(thinUSDC));
        PoolKey memory thinKey = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});
        manager.initialize(thinKey, SQRT_PRICE_1_1); // initialized, but deliberately NEVER seeded with liquidity

        address[] memory supported = new address[](2);
        supported[0] = address(thinUSDC);
        supported[1] = address(thinRWA);
        PayGuardVault thinVault = new PayGuardVault(owner, supported);
        PayGuardV4Adapter thinAdapter =
            new PayGuardV4Adapter(IPoolManager(address(manager)), address(thinVault), c0, c1, 3000, 60, IHooks(address(0)));

        IPayGuardVault.PolicyConfig memory config = IPayGuardVault.PolicyConfig({
            agent: agent,
            inputToken: address(thinRWA),
            settlementToken: address(thinUSDC),
            adapter: address(thinAdapter),
            routeId: thinAdapter.ROUTE_ID(),
            totalOutputBudget: 300_000_000,
            epochOutputBudget: 300_000_000,
            automaticOutputCap: 300_000_000,
            escalationOutputCap: 300_000_000,
            totalInputBudget: 1_000_000e18,
            maxInputPerPayment: 500_000e18,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 30 days),
            allowedCategoryBitmap: type(uint256).max,
            subsidyMode: IPayGuardVault.SubsidyMode.NONE
        });
        IPayGuardVault.MerchantPermission[] memory merchants = new IPayGuardVault.MerchantPermission[](1);
        merchants[0] = IPayGuardVault.MerchantPermission({
            merchantId: MERCHANT_ID, recipient: merchantRecipient, invoiceSigner: merchantSigner, category: 1
        });
        vm.prank(owner);
        bytes32 thinPolicyId = thinVault.createPolicy(config, merchants);

        thinRWA.mint(owner, 1_000_000e18);
        vm.startPrank(owner);
        thinRWA.approve(address(thinVault), type(uint256).max);
        thinVault.deposit(address(thinRWA), 1_000_000e18);
        vm.stopPrank();

        IPayGuardVault.Invoice memory invoice = IPayGuardVault.Invoice({
            invoiceId: bytes32(uint256(1)),
            merchantId: MERCHANT_ID,
            recipient: merchantRecipient,
            settlementToken: address(thinUSDC),
            outputAmount: 500_000,
            category: 1,
            validUntil: uint48(block.timestamp + 1 days)
        });
        IPayGuardVault.PaymentIntent memory intent = IPayGuardVault.PaymentIntent({
            policyId: thinPolicyId,
            invoiceHash: thinVault.hashInvoice(invoice),
            routeId: thinAdapter.ROUTE_ID(),
            maxInputAmount: 500_000e18,
            nonce: 1,
            validUntil: uint48(block.timestamp + 1 hours),
            subsidyMode: IPayGuardVault.SubsidyMode.NONE,
            maxSubsidyAmount: 0
        });
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(AGENT_KEY, thinVault.hashIntent(intent));
        bytes memory agentSig = abi.encodePacked(r1, s1, v1);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(MERCHANT_SIGNER_KEY, thinVault.hashInvoice(invoice));
        bytes memory merchantSig = abi.encodePacked(r2, s2, v2);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        // With zero liquidity in range, the real v4 pool moves no price and returns a delta with
        // ZERO output (it does not revert on its own) -- the adapter's own exact-output-delivered
        // check is what turns this into a real failure, pinned to the exact selector so this test
        // cannot start silently passing for an unrelated reason.
        vm.expectRevert(abi.encodeWithSelector(PayGuardV4Adapter.OutputShortfall.selector, 500_000, 0));
        thinVault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        assertFalse(thinVault.isInvoiceConsumed(merchantRecipient, bytes32(uint256(1))));
    }

    // ---- Wrong route: policy.routeId misconfigured against this adapter's pinned ROUTE_ID -----

    function test_WrongRoute_PolicyMisconfiguredAgainstAdapter_Reverts() public {
        IPayGuardVault.PolicyConfig memory config = IPayGuardVault.PolicyConfig({
            agent: agent,
            inputToken: address(mRWA),
            settlementToken: address(mUSDC),
            adapter: address(adapter),
            routeId: bytes32(uint256(777)), // deliberately NOT adapter.ROUTE_ID()
            totalOutputBudget: 300_000_000,
            epochOutputBudget: 300_000_000,
            automaticOutputCap: 300_000_000,
            escalationOutputCap: 300_000_000,
            totalInputBudget: 1_000_000e18,
            maxInputPerPayment: 500_000e18,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 30 days),
            allowedCategoryBitmap: type(uint256).max,
            subsidyMode: IPayGuardVault.SubsidyMode.NONE
        });
        IPayGuardVault.MerchantPermission[] memory merchants = new IPayGuardVault.MerchantPermission[](1);
        merchants[0] = IPayGuardVault.MerchantPermission({
            merchantId: MERCHANT_ID, recipient: merchantRecipient, invoiceSigner: merchantSigner, category: 1
        });
        vm.prank(owner);
        bytes32 wrongRoutePolicyId = vault.createPolicy(config, merchants);

        IPayGuardVault.Invoice memory invoice = IPayGuardVault.Invoice({
            invoiceId: bytes32(uint256(1)),
            merchantId: MERCHANT_ID,
            recipient: merchantRecipient,
            settlementToken: address(mUSDC),
            outputAmount: 500_000,
            category: 1,
            validUntil: uint48(block.timestamp + 1 days)
        });
        IPayGuardVault.PaymentIntent memory intent = IPayGuardVault.PaymentIntent({
            policyId: wrongRoutePolicyId,
            invoiceHash: vault.hashInvoice(invoice),
            routeId: bytes32(uint256(777)), // matches the policy, so evaluate() ALLOWs
            maxInputAmount: 50_000e18,
            nonce: 1,
            validUntil: uint48(block.timestamp + 1 hours),
            subsidyMode: IPayGuardVault.SubsidyMode.NONE,
            maxSubsidyAmount: 0
        });
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        // Passes the vault's own route check (intent.routeId == policy.routeId), but the
        // ADAPTER itself refuses -- its pinned ROUTE_ID never matches an arbitrary policy value.
        vm.expectRevert(PayGuardV4Adapter.WrongRoute.selector);
        vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);
    }

    // ---- Wrong token: a policy pair the adapter was never deployed for -------------------------

    function test_WrongToken_UnsupportedPairForThisAdapter_Reverts() public {
        MockERC20 thirdToken = new MockERC20("Third", "TKC", 18);
        // `adapter.ROUTE_ID()` is itself an external call -- reading it inline inside the struct
        // literal below the prank would consume vm.prank's single-shot effect before
        // `createPolicy` ever executes, making the call run as the test contract (Unauthorized)
        // instead of as the owner (InvalidToken). Hoisted out so the prank lands on the right call.
        bytes32 v4RouteId = adapter.ROUTE_ID();
        vm.prank(owner);
        try vault.createPolicy(
            IPayGuardVault.PolicyConfig({
                agent: agent,
                inputToken: address(thirdToken),
                settlementToken: address(mUSDC),
                adapter: address(adapter),
                routeId: v4RouteId,
                totalOutputBudget: 300_000_000,
                epochOutputBudget: 300_000_000,
                automaticOutputCap: 300_000_000,
                escalationOutputCap: 300_000_000,
                totalInputBudget: 1_000_000e18,
                maxInputPerPayment: 500_000e18,
                validAfter: uint48(block.timestamp),
                validUntil: uint48(block.timestamp + 30 days),
                allowedCategoryBitmap: type(uint256).max,
                subsidyMode: IPayGuardVault.SubsidyMode.NONE
            }),
            _oneMerchant()
        ) returns (bytes32) {
            fail();
        } catch (bytes memory reason) {
            // thirdToken was never added to THIS vault's immutable supportedTokenMap --
            // createPolicy itself already refuses it (InvalidToken), before the adapter is ever
            // reached. Confirms the vault's own token allowlist is the first real gate.
            assertEq(bytes4(reason), PayGuardVault.InvalidToken.selector);
        }
    }

    function _oneMerchant() internal view returns (IPayGuardVault.MerchantPermission[] memory merchants) {
        merchants = new IPayGuardVault.MerchantPermission[](1);
        merchants[0] = IPayGuardVault.MerchantPermission({
            merchantId: MERCHANT_ID, recipient: merchantRecipient, invoiceSigner: merchantSigner, category: 1
        });
    }

    // ---- unlockCallback authentication -----------------------------------------------------

    function test_UnlockCallback_WrongCaller_NotPoolManager_Reverts() public {
        vm.expectRevert(PayGuardV4Adapter.NotPoolManager.selector);
        adapter.unlockCallback(abi.encode(true, int256(1), uint256(1)));
    }

    function test_UnlockCallback_CalledWithoutActiveSettle_Reverts() public {
        // Even the REAL PoolManager address, calling out of turn (no settle() currently
        // awaiting it), is refused -- the callback is never a standalone entry point.
        vm.prank(address(manager));
        vm.expectRevert(PayGuardV4Adapter.NoActiveCallback.selector);
        adapter.unlockCallback(abi.encode(true, int256(1), uint256(1)));
    }

    function test_UnlockCallback_ReplayImmediatelyAfterARealSettle_Reverts() public {
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(1)), 500_000, 50_000e18, 1);
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();
        vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        // The settle() that just completed already cleared `_awaitingCallback` -- a replay
        // attempt right after, even from the real PoolManager address, is refused.
        vm.prank(address(manager));
        vm.expectRevert(PayGuardV4Adapter.NoActiveCallback.selector);
        adapter.unlockCallback(abi.encode(true, int256(1), uint256(1)));
    }

    // ---- settle() caller binding -------------------------------------------------------------

    function test_Settle_CalledByNonVault_Reverts() public {
        IPayGuardSettlementAdapter.SettlementRequest memory request = IPayGuardSettlementAdapter.SettlementRequest({
            intentHash: bytes32(0),
            routeId: adapter.ROUTE_ID(),
            inputToken: address(mRWA),
            outputToken: address(mUSDC),
            merchant: merchantRecipient,
            exactOutput: 500_000,
            maxInput: 50_000e18,
            validUntil: uint48(block.timestamp + 1 hours),
            subsidyMode: IPayGuardVault.SubsidyMode.NONE,
            maxSubsidyAmount: 0
        });
        vm.expectRevert(PayGuardV4Adapter.NotVault.selector);
        adapter.settle(request);
    }

    function test_Settle_ContextMismatch_UnreachableThroughRealVault_ButGuardedDirectly() public {
        // Proves the context-correlation guard (PayGuardV4Adapter.sol) is real, reachable code --
        // not dead code -- using a minimal mock "vault" that never sets a matching execution
        // context. The genuine PayGuardVault always sets a matching context before calling
        // settle(), so this branch is otherwise unreachable through the real path.
        MockVaultForContextMismatch mockVault = new MockVaultForContextMismatch();
        PayGuardV4Adapter mockAdapter = new PayGuardV4Adapter(
            IPoolManager(address(manager)), address(mockVault), currency0, currency1, 3000, 60, IHooks(address(0))
        );
        IPayGuardSettlementAdapter.SettlementRequest memory request = IPayGuardSettlementAdapter.SettlementRequest({
            intentHash: bytes32(0),
            routeId: mockAdapter.ROUTE_ID(),
            inputToken: address(mRWA),
            outputToken: address(mUSDC),
            merchant: merchantRecipient,
            exactOutput: 500_000,
            maxInput: 50_000e18,
            validUntil: uint48(block.timestamp + 1 hours),
            subsidyMode: IPayGuardVault.SubsidyMode.NONE,
            maxSubsidyAmount: 0
        });
        vm.expectRevert(PayGuardV4Adapter.ContextMismatch.selector);
        mockVault.callSettle(mockAdapter, request);
    }

    // ---- ESCALATE with a real owner approval, over the real v4 route --------------------------

    function test_Escalate_RealOwnerApproval_SettlesOverV4() public {
        // 150 mUSDC exceeds the 100 mUSDC automaticOutputCap but is within the 200 mUSDC
        // escalationOutputCap -- forces ESCALATE.
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(2)), 150_000_000, 200_000e18, 2);
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);

        bytes32 intentHash = vault.hashIntent(intent);
        IPayGuardVault.ExceptionApproval memory approval =
            IPayGuardVault.ExceptionApproval({intentHash: intentHash, nonce: uint256(intentHash), validUntil: uint48(block.timestamp + 1 hours)});
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, vault.hashApproval(approval));
        bytes memory ownerSig = abi.encodePacked(r, s, v);

        IPayGuardVault.Evaluation memory evaluation =
            vault.evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        assertEq(uint8(evaluation.decision), uint8(IPayGuardVault.Decision.ALLOW));

        uint256 merchantBefore = mUSDC.balanceOf(merchantRecipient);
        vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        assertEq(mUSDC.balanceOf(merchantRecipient) - merchantBefore, 150_000_000);
    }

    // ---- Duplicate invoice: a second intent for the same invoice cannot double-pay ------------

    function test_DuplicateInvoice_SecondIntent_CannotDoublePay() public {
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(3)), 500_000, 50_000e18, 3);
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();
        vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        // Same invoiceId/recipient, a genuinely DIFFERENT intent (new nonce) -- vault-scoped
        // invoice identity must reject it regardless of which fresh intent tries to pay it again.
        (, IPayGuardVault.PaymentIntent memory secondIntent) =
            _invoiceAndIntent(bytes32(uint256(3)), 500_000, 50_000e18, 4);
        (bytes memory agentSig2, bytes memory merchantSig2) = _sigs(invoice, secondIntent);

        vm.expectRevert(abi.encodeWithSelector(IPayGuardVault.PaymentRejected.selector, IPayGuardVault.Reason.INVOICE_ALREADY_PAID));
        vault.executePayment(invoice, secondIntent, agentSig2, merchantSig2, approval, ownerSig);
    }
}
