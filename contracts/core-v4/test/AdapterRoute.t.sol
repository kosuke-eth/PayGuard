// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PayGuardTestBase} from "./helpers/PayGuardTestBase.sol";
import {IPayGuardVault} from "../src/interfaces/IPayGuardVault.sol";
import {TestSettlementAdapter} from "./fixtures/TestSettlementAdapter.sol";
import {MaliciousReentrantAdapter} from "./fixtures/MaliciousReentrantAdapter.sol";

/// Adapter-route matrix: happy path through a test-only adapter, every settlement-invariant
/// violation the vault's own measured balance deltas must catch regardless of what the adapter
/// claims, reentrancy through the adapter callback, and allowance/state residue on every
/// reverted path (CLAUDE.md: "revert the whole payment on failed postconditions"; "an adapter's
/// return values ... cannot prove settlement"). Test-only adapters -- not a Stage 6 protocol
/// integration (Prompt 2 checkpoint requirement).
contract AdapterRouteTest is PayGuardTestBase {
    TestSettlementAdapter internal adapter;
    bytes32 internal policyId;

    function setUp() public {
        _baseSetUp();
        adapter = new TestSettlementAdapter();

        IPayGuardVault.PolicyConfig memory config = IPayGuardVault.PolicyConfig({
            agent: agent,
            inputToken: address(tokenA),
            settlementToken: address(tokenB),
            adapter: address(adapter),
            routeId: bytes32(uint256(1)),
            totalOutputBudget: 1_000e18,
            epochOutputBudget: 1_000e18,
            automaticOutputCap: 1_000e18,
            escalationOutputCap: 1_000e18,
            totalInputBudget: 1_000e18,
            maxInputPerPayment: 1_000e18,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 30 days),
            allowedCategoryBitmap: type(uint256).max,
            subsidyMode: IPayGuardVault.SubsidyMode.NONE
        });
        vm.prank(owner);
        policyId = vault.createPolicy(config, _defaultMerchants());

        tokenA.mint(address(vault), 1_000e18); // input liquidity the vault will forward
        tokenB.mint(address(adapter), 1_000e18); // output liquidity the adapter will deliver
    }

    function _adapterInvoiceAndIntent(bytes32 invoiceId, uint256 outputAmount, uint256 maxInputAmount, uint256 nonce)
        internal
        view
        returns (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent)
    {
        invoice = IPayGuardVault.Invoice({
            invoiceId: invoiceId,
            merchantId: MERCHANT_ID,
            recipient: merchantRecipient,
            settlementToken: address(tokenB),
            outputAmount: outputAmount,
            category: 1,
            validUntil: uint48(block.timestamp + 1 days)
        });
        intent = IPayGuardVault.PaymentIntent({
            policyId: policyId,
            invoiceHash: vault.hashInvoice(invoice),
            routeId: bytes32(uint256(1)),
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
        agentSig = _signIntent(AGENT_KEY, intent);
        merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);
    }

    function test_happyPath_exactDeltas_noResidualAllowance() public {
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _adapterInvoiceAndIntent(bytes32(uint256(1)), 100e18, 80e18, 1);
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        adapter.configure(60e18, 100e18); // pulls 60 tokenA, delivers exactly the 100 tokenB owed

        uint256 vaultInputBefore = tokenA.balanceOf(address(vault));
        uint256 merchantBefore = tokenB.balanceOf(merchantRecipient);

        (, uint256 actualInput,) = vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        assertEq(actualInput, 60e18);
        assertEq(vaultInputBefore - tokenA.balanceOf(address(vault)), 60e18);
        assertEq(tokenB.balanceOf(merchantRecipient) - merchantBefore, 100e18);
        assertEq(tokenA.allowance(address(vault), address(adapter)), 0); // cleared post-settlement

        IPayGuardVault.ExecutionContext memory ctx = vault.getExecutionContext();
        assertFalse(ctx.active);

        IPayGuardVault.PolicyState memory state = vault.getPolicyState(policyId);
        assertEq(state.inputSpent, 60e18); // reservation (80e18) refunded down to actual (60e18)
    }

    function test_fabricatedReturnValues_ignoredInFavorOfMeasuredDeltas() public {
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _adapterInvoiceAndIntent(bytes32(uint256(1)), 100e18, 80e18, 1);
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        adapter.configure(60e18, 100e18);
        adapter.configureFabricatedReturn(1, 1); // claims via return value it moved almost nothing

        (, uint256 actualInput,) = vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        // The vault never reads settle()'s return tuple -- actualInput still reflects the real
        // measured balance delta, not the adapter's fabricated claim.
        assertEq(actualInput, 60e18);
    }

    function test_overPull_beyondMaxInput_reverts() public {
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _adapterInvoiceAndIntent(bytes32(uint256(1)), 100e18, 80e18, 1);
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        adapter.configure(90e18, 100e18); // pulls more than the vault approved (80e18 maxInput)

        vm.expectRevert(); // solmate ERC20 transferFrom underflows: pull exceeds the forceApprove(adapter, maxInput) allowance cap
        vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        // Pre-execution state preserved on the reverted path.
        assertFalse(vault.isInvoiceConsumed(merchantRecipient, bytes32(uint256(1))));
        assertFalse(vault.isAgentNonceUsed(agent, 1));
        IPayGuardVault.PolicyState memory state = vault.getPolicyState(policyId);
        assertEq(state.inputSpent, 0);
    }

    function test_incompleteOutputDelivery_settlementInvariantReverts() public {
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _adapterInvoiceAndIntent(bytes32(uint256(1)), 100e18, 80e18, 1);
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        adapter.configure(60e18, 40e18); // delivers less than the 100e18 exact output owed

        vm.expectRevert(IPayGuardVault.SettlementInvariant.selector);
        vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        assertFalse(vault.isInvoiceConsumed(merchantRecipient, bytes32(uint256(1))));
        IPayGuardVault.PolicyState memory state = vault.getPolicyState(policyId);
        assertEq(state.outputSpent, 0);
        assertEq(state.inputSpent, 0);
    }

    function test_excessOutputDelivery_settlementInvariantReverts() public {
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _adapterInvoiceAndIntent(bytes32(uint256(1)), 100e18, 80e18, 1);
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        adapter.configure(60e18, 150e18); // delivers more than the exact output owed

        vm.expectRevert(IPayGuardVault.SettlementInvariant.selector);
        vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);
    }

    function test_failedAdapterCall_wholePaymentReverts_allowanceCleared() public {
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _adapterInvoiceAndIntent(bytes32(uint256(1)), 100e18, 80e18, 1);
        (bytes memory agentSig, bytes memory merchantSig) = _sigs(invoice, intent);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        adapter.configureRevert();

        vm.expectRevert(bytes("TestSettlementAdapter: configured to revert"));
        vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        // Even the pre-settle forceApprove is rolled back with the whole transaction.
        assertEq(tokenA.allowance(address(vault), address(adapter)), 0);
        assertFalse(vault.isInvoiceConsumed(merchantRecipient, bytes32(uint256(1))));
    }

    function test_aliasedRecipient_adapterAddress_settlementInvariantReverts() public {
        // Merchant recipient aliased to the adapter itself would break the delta-accounting
        // assumptions in _settleViaAdapter -- must be rejected outright.
        IPayGuardVault.MerchantPermission[] memory merchants = new IPayGuardVault.MerchantPermission[](1);
        merchants[0] = IPayGuardVault.MerchantPermission({
            merchantId: MERCHANT_ID,
            recipient: address(adapter),
            invoiceSigner: merchantSigner,
            category: 1
        });
        IPayGuardVault.PolicyConfig memory config = IPayGuardVault.PolicyConfig({
            agent: agent,
            inputToken: address(tokenA),
            settlementToken: address(tokenB),
            adapter: address(adapter),
            routeId: bytes32(uint256(1)),
            totalOutputBudget: 1_000e18,
            epochOutputBudget: 1_000e18,
            automaticOutputCap: 1_000e18,
            escalationOutputCap: 1_000e18,
            totalInputBudget: 1_000e18,
            maxInputPerPayment: 1_000e18,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 30 days),
            allowedCategoryBitmap: type(uint256).max,
            subsidyMode: IPayGuardVault.SubsidyMode.NONE
        });
        vm.prank(owner);
        bytes32 aliasedPolicyId = vault.createPolicy(config, merchants);

        IPayGuardVault.Invoice memory invoice = IPayGuardVault.Invoice({
            invoiceId: bytes32(uint256(1)),
            merchantId: MERCHANT_ID,
            recipient: address(adapter),
            settlementToken: address(tokenB),
            outputAmount: 100e18,
            category: 1,
            validUntil: uint48(block.timestamp + 1 days)
        });
        IPayGuardVault.PaymentIntent memory intent = IPayGuardVault.PaymentIntent({
            policyId: aliasedPolicyId,
            invoiceHash: vault.hashInvoice(invoice),
            routeId: bytes32(uint256(1)),
            maxInputAmount: 80e18,
            nonce: 1,
            validUntil: uint48(block.timestamp + 1 hours),
            subsidyMode: IPayGuardVault.SubsidyMode.NONE,
            maxSubsidyAmount: 0
        });
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        adapter.configure(60e18, 100e18);
        vm.expectRevert(IPayGuardVault.SettlementInvariant.selector);
        vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);
    }

    function test_reentrantAdapter_innerCallBlocked_wholePaymentReverts() public {
        MaliciousReentrantAdapter maliciousAdapter = new MaliciousReentrantAdapter(address(vault));

        IPayGuardVault.PolicyConfig memory config = IPayGuardVault.PolicyConfig({
            agent: agent,
            inputToken: address(tokenA),
            settlementToken: address(tokenB),
            adapter: address(maliciousAdapter),
            routeId: bytes32(uint256(1)),
            totalOutputBudget: 1_000e18,
            epochOutputBudget: 1_000e18,
            automaticOutputCap: 1_000e18,
            escalationOutputCap: 1_000e18,
            totalInputBudget: 1_000e18,
            maxInputPerPayment: 1_000e18,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 30 days),
            allowedCategoryBitmap: type(uint256).max,
            subsidyMode: IPayGuardVault.SubsidyMode.NONE
        });
        vm.prank(owner);
        bytes32 maliciousPolicyId = vault.createPolicy(config, _defaultMerchants());

        IPayGuardVault.Invoice memory invoice = IPayGuardVault.Invoice({
            invoiceId: bytes32(uint256(1)),
            merchantId: MERCHANT_ID,
            recipient: merchantRecipient,
            settlementToken: address(tokenB),
            outputAmount: 100e18,
            category: 1,
            validUntil: uint48(block.timestamp + 1 days)
        });
        IPayGuardVault.PaymentIntent memory intent = IPayGuardVault.PaymentIntent({
            policyId: maliciousPolicyId,
            invoiceHash: vault.hashInvoice(invoice),
            routeId: bytes32(uint256(1)),
            maxInputAmount: 80e18,
            nonce: 1,
            validUntil: uint48(block.timestamp + 1 hours),
            subsidyMode: IPayGuardVault.SubsidyMode.NONE,
            maxSubsidyAmount: 0
        });
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        // Arm the malicious adapter to re-enter with a second, distinct executePayment call
        // (a different invoiceId/nonce) while the first is still mid-flight.
        IPayGuardVault.Invoice memory reentryInvoice = IPayGuardVault.Invoice({
            invoiceId: bytes32(uint256(2)),
            merchantId: MERCHANT_ID,
            recipient: merchantRecipient,
            settlementToken: address(tokenB),
            outputAmount: 1e18,
            category: 1,
            validUntil: uint48(block.timestamp + 1 days)
        });
        IPayGuardVault.PaymentIntent memory reentryIntent = IPayGuardVault.PaymentIntent({
            policyId: maliciousPolicyId,
            invoiceHash: vault.hashInvoice(reentryInvoice),
            routeId: bytes32(uint256(1)),
            maxInputAmount: 1e18,
            nonce: 2,
            validUntil: uint48(block.timestamp + 1 hours),
            subsidyMode: IPayGuardVault.SubsidyMode.NONE,
            maxSubsidyAmount: 0
        });
        bytes memory reentryAgentSig = _signIntent(AGENT_KEY, reentryIntent);
        bytes memory reentryMerchantSig = _signInvoice(MERCHANT_SIGNER_KEY, reentryInvoice);
        bytes memory reentryCalldata = abi.encodeCall(
            vault.executePayment, (reentryInvoice, reentryIntent, reentryAgentSig, reentryMerchantSig, approval, ownerSig)
        );
        maliciousAdapter.arm(reentryCalldata);

        vm.expectRevert(MaliciousReentrantAdapter.MaliciousAdapterAborted.selector);
        vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        // The whole outer payment rolled back too -- neither invoice was consumed.
        assertFalse(vault.isInvoiceConsumed(merchantRecipient, bytes32(uint256(1))));
        assertFalse(vault.isInvoiceConsumed(merchantRecipient, bytes32(uint256(2))));
    }
}
