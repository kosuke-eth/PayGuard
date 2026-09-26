// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * B4: real 1inch Aqua/SwapVM exact-output settlement through the ACTUAL, unmodified 0.8.26
 * PayGuardVault -- deployed here via forge-std's `deployCode` cheatcode directly from
 * `contracts/core-v4`'s own compiled artifact (../core-v4/out/PayGuardVault.sol/PayGuardVault.json),
 * never reimplemented or reimported at the source level (this project is pinned to solc 0.8.30;
 * the vault is pinned to solc 0.8.26 -- see src/interfaces/IPayGuardSettlementAdapterShim.sol for
 * why, and script/check-abi-equivalence.mjs for the ABI-equivalence proof). A real Aqua instance,
 * a real AquaSwapVMRouter, a real maker shipping a real bounded XYCSwap position with real token
 * inventory and a real Aqua allowance (`AquaMakerFixture`), and the real `PayGuardAquaAdapter`
 * bound to that vault/maker/strategy.
 */

import { Test } from "forge-std/Test.sol";
import { TokenMock } from "@1inch/solidity-utils/contracts/mocks/TokenMock.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";

import { PayGuardAquaAdapter } from "../src/PayGuardAquaAdapter.sol";
import { IPayGuardSettlementAdapterShim } from "../src/interfaces/IPayGuardSettlementAdapterShim.sol";
import { IPayGuardVaultTestShim } from "./interfaces/IPayGuardVaultTestShim.sol";
import { AquaMakerFixture } from "./fixtures/AquaMakerFixture.sol";

contract MockVaultForContextMismatch {
    // Minimal stand-in exposing ONLY what PayGuardAquaAdapter.settle() reads
    // (getExecutionContext) -- mirrors PayGuardV4Adapter.t.sol's own MockVaultForContextMismatch
    // (B3) exactly, proving the context-correlation guard is real, reachable code even though the
    // real vault always sets a matching context.
    function getExecutionContext() external pure returns (IPayGuardVaultTestShim.ExecutionContext memory ctx) {
        // active:false alone is enough to fail the adapter's check.
    }

    function callSettle(PayGuardAquaAdapter target, IPayGuardSettlementAdapterShim.SettlementRequest calldata request) external {
        target.settle(request);
    }
}

contract PayGuardAquaAdapterTest is Test {
    uint256 internal constant OWNER_KEY = 0xA11CE;
    uint256 internal constant AGENT_KEY = 0xA9E27;
    uint256 internal constant MERCHANT_SIGNER_KEY = 0xBEEF;
    uint256 internal constant MAKER_KEY = 0x5EED;

    address internal owner;
    address internal agent;
    address internal merchantSigner;
    address internal merchant = address(0xCAFE);
    address internal maker;
    bytes32 internal constant MERCHANT_ID = keccak256("aqua-test-merchant");

    Aqua internal aqua;
    AquaMakerFixture internal makerFixture;
    TokenMock internal aqInput; // payer's input token
    TokenMock internal aqOutput; // merchant settlement token
    ISwapVM.Order internal order;
    bytes32 internal strategyHash;

    uint256 internal constant MAKER_BALANCE_IN = 1_000_000e18;
    uint256 internal constant MAKER_BALANCE_OUT = 1_000_000e18;

    address internal vault; // real 0.8.26 PayGuardVault, deployed via deployCode
    PayGuardAquaAdapter internal adapter;
    bytes32 internal policyId;

    function setUp() public {
        owner = vm.addr(OWNER_KEY);
        agent = vm.addr(AGENT_KEY);
        merchantSigner = vm.addr(MERCHANT_SIGNER_KEY);
        maker = vm.addr(MAKER_KEY);

        aqua = new Aqua();
        aqInput = new TokenMock("Aqua Input", "AQIN");
        aqOutput = new TokenMock("Aqua Output", "AQOUT");

        makerFixture = new AquaMakerFixture(address(aqua), address(0), address(this));

        order = makerFixture.buildOrder(maker, uint256(keccak256(abi.encode(block.timestamp, "b4-fixture"))));

        // Real bounded position: maker actually holds and approves BOTH tokens before shipping.
        aqInput.mint(maker, MAKER_BALANCE_IN);
        aqOutput.mint(maker, MAKER_BALANCE_OUT);
        strategyHash = makerFixture.shipStrategy(vm, aqua, maker, order, aqInput, aqOutput, MAKER_BALANCE_IN, MAKER_BALANCE_OUT);

        address[] memory supported = new address[](2);
        supported[0] = address(aqInput);
        supported[1] = address(aqOutput);
        vault = deployCode("../core-v4/out/PayGuardVault.sol/PayGuardVault.json", abi.encode(owner, supported));

        adapter = new PayGuardAquaAdapter(
            aqua, makerFixture.router(), vault, maker, order.traits, order.data, address(aqInput), address(aqOutput)
        );
        assertEq(adapter.orderHash(), strategyHash, "adapter's own orderHash must match Aqua's strategyHash");

        IPayGuardVaultTestShim.PolicyConfig memory config = IPayGuardVaultTestShim.PolicyConfig({
            agent: agent,
            inputToken: address(aqInput),
            settlementToken: address(aqOutput),
            adapter: address(adapter),
            routeId: adapter.ROUTE_ID(),
            totalOutputBudget: 300_000e18,
            epochOutputBudget: 300_000e18,
            automaticOutputCap: 100_000e18,
            escalationOutputCap: 200_000e18,
            totalInputBudget: 1_000_000e18,
            maxInputPerPayment: 500_000e18,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 30 days),
            allowedCategoryBitmap: type(uint256).max,
            subsidyMode: IPayGuardVaultTestShim.SubsidyMode.NONE
        });
        IPayGuardVaultTestShim.MerchantPermission[] memory merchants = new IPayGuardVaultTestShim.MerchantPermission[](1);
        merchants[0] = IPayGuardVaultTestShim.MerchantPermission({
            merchantId: MERCHANT_ID,
            recipient: merchant,
            invoiceSigner: merchantSigner,
            category: 1
        });
        vm.prank(owner);
        policyId = IPayGuardVaultTestShim(vault).createPolicy(config, merchants);

        // Owner deposit: the vault needs real aqInput balance to forward to the adapter -- through
        // the vault's own real deposit() path, not a test shortcut.
        aqInput.mint(owner, 1_000_000e18);
        vm.startPrank(owner);
        aqInput.approve(vault, type(uint256).max);
        IPayGuardVaultTestShim(vault).deposit(address(aqInput), 1_000_000e18);
        vm.stopPrank();
    }

    function _invoiceAndIntent(bytes32 invoiceId, uint256 outputAmount, uint256 maxInputAmount, uint256 nonce)
        internal
        view
        returns (IPayGuardVaultTestShim.Invoice memory invoice, IPayGuardVaultTestShim.PaymentIntent memory intent)
    {
        invoice = IPayGuardVaultTestShim.Invoice({
            invoiceId: invoiceId,
            merchantId: MERCHANT_ID,
            recipient: merchant,
            settlementToken: address(aqOutput),
            outputAmount: outputAmount,
            category: 1,
            validUntil: uint48(block.timestamp + 1 days)
        });
        intent = IPayGuardVaultTestShim.PaymentIntent({
            policyId: policyId,
            invoiceHash: IPayGuardVaultTestShim(vault).hashInvoice(invoice),
            routeId: adapter.ROUTE_ID(),
            maxInputAmount: maxInputAmount,
            nonce: nonce,
            validUntil: uint48(block.timestamp + 1 hours),
            subsidyMode: IPayGuardVaultTestShim.SubsidyMode.NONE,
            maxSubsidyAmount: 0
        });
    }

    function _sigs(IPayGuardVaultTestShim.Invoice memory invoice, IPayGuardVaultTestShim.PaymentIntent memory intent)
        internal
        view
        returns (bytes memory agentSig, bytes memory merchantSig)
    {
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(AGENT_KEY, IPayGuardVaultTestShim(vault).hashIntent(intent));
        agentSig = abi.encodePacked(r1, s1, v1);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(MERCHANT_SIGNER_KEY, IPayGuardVaultTestShim(vault).hashInvoice(invoice));
        merchantSig = abi.encodePacked(r2, s2, v2);
    }

    function _emptyApproval() internal pure returns (IPayGuardVaultTestShim.ExceptionApproval memory approval, bytes memory sig) {
        approval = IPayGuardVaultTestShim.ExceptionApproval({ intentHash: bytes32(0), nonce: 0, validUntil: 0 });
        sig = bytes("");
    }

    // ---- Happy path: bare protocol success through the real vault ----------------------------

    function test_RealAquaSwap_HappyPath_DeliversExactOutput_RealMeasuredDeltas() public {
        (IPayGuardVaultTestShim.Invoice memory invoice, IPayGuardVaultTestShim.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(1)), 1_000e18, 5_000e18, 1);
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);
        (IPayGuardVaultTestShim.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        IPayGuardVaultTestShim.Evaluation memory evaluation =
            IPayGuardVaultTestShim(vault).evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        assertEq(uint8(evaluation.decision), uint8(IPayGuardVaultTestShim.Decision.ALLOW));

        uint256 vaultInputBefore = aqInput.balanceOf(vault);
        uint256 merchantBefore = aqOutput.balanceOf(merchant);
        uint256 adapterInBefore = aqInput.balanceOf(address(adapter));
        uint256 adapterOutBefore = aqOutput.balanceOf(address(adapter));

        (, uint256 actualInput,) = IPayGuardVaultTestShim(vault).executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        // Real token conservation: exact merchant receipt, bounded payer input, zero adapter
        // residue (both legs), zero unpaid Aqua-tracked ledger delta (maker's real wallet moved).
        assertEq(aqOutput.balanceOf(merchant) - merchantBefore, 1_000e18, "merchant must receive exactly the invoiced output");
        assertEq(vaultInputBefore - aqInput.balanceOf(vault), actualInput, "vault's own input debit must equal the reported actualInput");
        assertLe(actualInput, 5_000e18, "actualInput must respect the intent's maxInputAmount");
        assertEq(aqInput.balanceOf(address(adapter)), adapterInBefore, "adapter must hold zero input residue after settlement");
        assertEq(aqOutput.balanceOf(address(adapter)), adapterOutBefore, "adapter must hold zero output residue after settlement");
        assertEq(aqInput.allowance(vault, address(adapter)), 0, "vault's allowance to the adapter must be cleared after settlement");

        IPayGuardVaultTestShim.PolicyState memory policyState = IPayGuardVaultTestShim(vault).getPolicyState(policyId);
        assertEq(policyState.outputSpent, 1_000e18);
        assertEq(policyState.inputSpent, actualInput);
    }

    // ---- Distinct public-API success proven separately in test/AquaRoute.api.test.ts ---------

    // ---- Max-input threshold: exceeding it reverts the whole payment, no partial fill --------

    function test_RealAquaSwap_MaxInputExceeded_WholePaymentReverts_StateUntouched() public {
        // Request an output large enough that the real XYCSwap curve needs more input than the
        // tiny maxInputAmount allows.
        (IPayGuardVaultTestShim.Invoice memory invoice, IPayGuardVaultTestShim.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(2)), 500_000e18, 1, 2);
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);
        (IPayGuardVaultTestShim.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        IPayGuardVaultTestShim.PolicyState memory before = IPayGuardVaultTestShim(vault).getPolicyState(policyId);

        // TakerTraitsLib's own max-input-threshold check fires inside `router.swap()`, before this
        // adapter's own redundant check -- assert only that SOME revert occurred, the state stayed
        // untouched, and the invoice is still payable (the earlier failed attempt did not consume it).
        vm.expectRevert();
        IPayGuardVaultTestShim(vault).executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        IPayGuardVaultTestShim.PolicyState memory afterState = IPayGuardVaultTestShim(vault).getPolicyState(policyId);
        assertEq(afterState.outputSpent, before.outputSpent, "output budget must be untouched by a reverted payment");
        assertEq(afterState.inputSpent, before.inputSpent, "input budget must be untouched by a reverted payment");
        assertFalse(IPayGuardVaultTestShim(vault).getExecutionContext().active);

        // The SAME invoice must still be genuinely payable afterward (never partially consumed).
        (IPayGuardVaultTestShim.Invoice memory invoice2, IPayGuardVaultTestShim.PaymentIntent memory intent2) =
            _invoiceAndIntent(bytes32(uint256(2)), 1_000e18, 5_000e18, 3);
        (bytes memory agentSig2, bytes memory merchantSig2) = _sigs(invoice2, intent2);
        IPayGuardVaultTestShim(vault).executePayment(invoice2, intent2, agentSig2, merchantSig2, approval, ownerSig);
        assertEq(aqOutput.balanceOf(merchant), 1_000e18);
    }

    // ---- Docked strategy: the maker revoking liquidity fails the payment atomically ----------

    function test_DockedStrategy_Reverts_NoConsumption() public {
        address[] memory tokens = new address[](2);
        tokens[0] = address(aqInput);
        tokens[1] = address(aqOutput);
        // `makerFixture.router()` is itself an external call (a public state-variable getter on
        // another contract) -- evaluating it inline as a call argument below the prank would
        // consume vm.prank's single-shot effect before `dock` ever executes, making the call run
        // as the test contract (a no-op no-registered-strategy path) instead of as the maker.
        // Same class of gotcha documented in contracts/core-v4's B3 evidence; hoisted out here too.
        address router = address(makerFixture.router());
        vm.prank(maker);
        aqua.dock(router, strategyHash, tokens);

        (IPayGuardVaultTestShim.Invoice memory invoice, IPayGuardVaultTestShim.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(3)), 1_000e18, 5_000e18, 4);
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);
        (IPayGuardVaultTestShim.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        // The docked strategy's Aqua balance query reverts inside the router itself
        // (SafeBalancesForTokenNotInActiveStrategy) before any transfer -- atomic, no consumption.
        IPayGuardVaultTestShim.PolicyState memory before = IPayGuardVaultTestShim(vault).getPolicyState(policyId);
        vm.expectRevert();
        IPayGuardVaultTestShim(vault).executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        IPayGuardVaultTestShim.PolicyState memory afterState = IPayGuardVaultTestShim(vault).getPolicyState(policyId);
        assertEq(afterState.outputSpent, before.outputSpent, "a docked strategy must not consume any output budget");
        assertEq(afterState.inputSpent, before.inputSpent, "a docked strategy must not consume any input budget");
    }

    // ---- Insufficient maker inventory: requesting more output than shipped fails atomically --

    function test_InsufficientInventory_Reverts() public {
        (IPayGuardVaultTestShim.Invoice memory invoice, IPayGuardVaultTestShim.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(4)), MAKER_BALANCE_OUT, type(uint256).max / 2, 5);
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);
        (IPayGuardVaultTestShim.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        // XYCSwap's exact-output formula divides by (balanceOut - amountOut); requesting the
        // FULL shipped balanceOut underflows that subtraction under Solidity 0.8 checked math.
        vm.expectRevert();
        IPayGuardVaultTestShim(vault).executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);
    }

    // ---- Wrong token: a policy pair this adapter was never deployed for ----------------------

    function test_WrongToken_UnsupportedPairForThisAdapter_Reverts() public {
        TokenMock thirdToken = new TokenMock("Third", "TKC");
        bytes32 aquaRouteId = adapter.ROUTE_ID();
        vm.prank(owner);
        try IPayGuardVaultTestShim(vault).createPolicy(
            IPayGuardVaultTestShim.PolicyConfig({
                agent: agent,
                inputToken: address(thirdToken),
                settlementToken: address(aqOutput),
                adapter: address(adapter),
                routeId: aquaRouteId,
                totalOutputBudget: 300_000e18,
                epochOutputBudget: 300_000e18,
                automaticOutputCap: 300_000e18,
                escalationOutputCap: 300_000e18,
                totalInputBudget: 1_000_000e18,
                maxInputPerPayment: 500_000e18,
                validAfter: uint48(block.timestamp),
                validUntil: uint48(block.timestamp + 30 days),
                allowedCategoryBitmap: type(uint256).max,
                subsidyMode: IPayGuardVaultTestShim.SubsidyMode.NONE
            }),
            _oneMerchant()
        ) returns (bytes32) {
            fail();
        } catch (bytes memory reason) {
            // thirdToken was never added to THIS vault's immutable supportedTokenMap --
            // createPolicy itself refuses it (InvalidToken selector 0xc1ab6dc1, cross-checked
            // against contracts/core-v4/src/PayGuardVault.sol's own `error InvalidToken()`),
            // before the adapter is ever reached.
            assertEq(bytes4(reason), bytes4(0xc1ab6dc1));
        }
    }

    function _oneMerchant() internal view returns (IPayGuardVaultTestShim.MerchantPermission[] memory merchants) {
        merchants = new IPayGuardVaultTestShim.MerchantPermission[](1);
        merchants[0] = IPayGuardVaultTestShim.MerchantPermission({
            merchantId: MERCHANT_ID, recipient: merchant, invoiceSigner: merchantSigner, category: 1
        });
    }

    // ---- Wrong callback caller: preTransferInCallback rejects anyone but the pinned router ---

    function test_PreTransferInCallback_WrongCaller_NotRouter_Reverts() public {
        vm.expectRevert(PayGuardAquaAdapter.NotRouter.selector);
        adapter.preTransferInCallback(maker, address(adapter), address(aqInput), address(aqOutput), 1e18, 1e18, strategyHash, "");
    }

    // ---- No active callback: the callback cannot be driven as a standalone entry point -------

    function test_PreTransferInCallback_CalledWithoutActiveSettle_Reverts() public {
        vm.prank(address(makerFixture.router()));
        vm.expectRevert(PayGuardAquaAdapter.NoActiveCallback.selector);
        adapter.preTransferInCallback(maker, address(adapter), address(aqInput), address(aqOutput), 1e18, 1e18, strategyHash, "");
    }

    // ---- preTransferOutCallback is never enabled by this adapter, and reverts if invoked -----

    function test_PreTransferOutCallback_AlwaysReverts() public {
        vm.expectRevert(PayGuardAquaAdapter.PreTransferOutCallbackNotSupported.selector);
        adapter.preTransferOutCallback(maker, address(adapter), address(aqInput), address(aqOutput), 1e18, 1e18, strategyHash, "");
    }

    // ---- Context mismatch: settle() called directly against a non-matching vault context -----

    function test_Settle_ContextMismatch_UnreachableThroughRealVault_ButGuardedDirectly() public {
        MockVaultForContextMismatch mockVault = new MockVaultForContextMismatch();
        PayGuardAquaAdapter mockAdapter = new PayGuardAquaAdapter(
            aqua, makerFixture.router(), address(mockVault), maker, order.traits, order.data, address(aqInput), address(aqOutput)
        );
        IPayGuardSettlementAdapterShim.SettlementRequest memory request = IPayGuardSettlementAdapterShim.SettlementRequest({
            intentHash: bytes32(uint256(1)),
            routeId: mockAdapter.ROUTE_ID(),
            inputToken: address(aqInput),
            outputToken: address(aqOutput),
            merchant: merchant,
            exactOutput: 1_000e18,
            maxInput: 5_000e18,
            validUntil: uint48(block.timestamp + 1 hours),
            subsidyMode: IPayGuardSettlementAdapterShim.SubsidyMode.NONE,
            maxSubsidyAmount: 0
        });
        vm.expectRevert(PayGuardAquaAdapter.ContextMismatch.selector);
        mockVault.callSettle(mockAdapter, request);
    }

    // ---- Deadline width/boundary: a validUntil beyond uint40's range is refused, not truncated

    function test_DeadlineOverflow_Reverts() public {
        MockVaultForContextMismatch mockVault = new MockVaultForContextMismatch();
        PayGuardAquaAdapter mockAdapter = new PayGuardAquaAdapter(
            aqua, makerFixture.router(), address(mockVault), maker, order.traits, order.data, address(aqInput), address(aqOutput)
        );
        IPayGuardSettlementAdapterShim.SettlementRequest memory request = IPayGuardSettlementAdapterShim.SettlementRequest({
            intentHash: bytes32(uint256(1)),
            routeId: mockAdapter.ROUTE_ID(),
            inputToken: address(aqInput),
            outputToken: address(aqOutput),
            merchant: merchant,
            exactOutput: 1_000e18,
            maxInput: 5_000e18,
            validUntil: uint48(type(uint40).max) + 1,
            subsidyMode: IPayGuardSettlementAdapterShim.SubsidyMode.NONE,
            maxSubsidyAmount: 0
        });
        vm.expectRevert(PayGuardAquaAdapter.DeadlineOverflow.selector);
        mockVault.callSettle(mockAdapter, request);
    }

    // ---- ESCALATE with a real owner approval, over the real Aqua route -----------------------

    function test_Escalate_RealOwnerApproval_SettlesOverAqua() public {
        // 150_000e18 output exceeds the 100_000e18 automaticOutputCap but is within the
        // 200_000e18 escalationOutputCap -- forces ESCALATE.
        (IPayGuardVaultTestShim.Invoice memory invoice, IPayGuardVaultTestShim.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(5)), 150_000e18, 400_000e18, 6);
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);

        bytes32 intentHash = IPayGuardVaultTestShim(vault).hashIntent(intent);
        IPayGuardVaultTestShim.ExceptionApproval memory approval = IPayGuardVaultTestShim.ExceptionApproval({
            intentHash: intentHash, nonce: uint256(intentHash), validUntil: uint48(block.timestamp + 1 hours)
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, IPayGuardVaultTestShim(vault).hashApproval(approval));
        bytes memory ownerSig = abi.encodePacked(r, s, v);

        IPayGuardVaultTestShim.Evaluation memory evaluation =
            IPayGuardVaultTestShim(vault).evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        assertEq(uint8(evaluation.decision), uint8(IPayGuardVaultTestShim.Decision.ALLOW));

        uint256 merchantBefore = aqOutput.balanceOf(merchant);
        IPayGuardVaultTestShim(vault).executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        assertEq(aqOutput.balanceOf(merchant) - merchantBefore, 150_000e18);
    }

    // ---- Duplicate invoice: a second intent for the same invoice cannot double-pay -----------

    function test_DuplicateInvoice_SecondIntent_CannotDoublePay() public {
        (IPayGuardVaultTestShim.Invoice memory invoice, IPayGuardVaultTestShim.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(6)), 1_000e18, 5_000e18, 7);
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);
        (IPayGuardVaultTestShim.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();
        IPayGuardVaultTestShim(vault).executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        (, IPayGuardVaultTestShim.PaymentIntent memory secondIntent) =
            _invoiceAndIntent(bytes32(uint256(6)), 1_000e18, 5_000e18, 8);
        (bytes memory agentSig2, bytes memory merchantSig2) = _sigs(invoice, secondIntent);

        vm.expectRevert(abi.encodeWithSelector(IPayGuardVaultTestShim.PaymentRejected.selector, IPayGuardVaultTestShim.Reason.INVOICE_ALREADY_PAID));
        IPayGuardVaultTestShim(vault).executePayment(invoice, secondIntent, agentSig2, merchantSig2, approval, ownerSig);
    }
}
