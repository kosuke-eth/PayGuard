// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PayGuardTestBase} from "./helpers/PayGuardTestBase.sol";
import {IPayGuardVault} from "../src/interfaces/IPayGuardVault.sol";

contract DirectPaymentTest is PayGuardTestBase {
    bytes32 internal policyId;

    function setUp() public {
        _baseSetUp();
        vm.prank(owner);
        policyId = vault.createPolicy(_defaultDirectPolicy(), _defaultMerchants());
        tokenA.mint(address(vault), 1_000e18);
    }

    function _happyPathArgs(bytes32 invoiceId, uint256 amount, uint256 nonce)
        internal
        view
        returns (
            IPayGuardVault.Invoice memory invoice,
            IPayGuardVault.PaymentIntent memory intent,
            bytes memory agentSig,
            bytes memory merchantSig,
            IPayGuardVault.ExceptionApproval memory approval,
            bytes memory ownerSig
        )
    {
        invoice = _defaultInvoice(invoiceId, amount);
        bytes32 invoiceHash = vault.hashInvoice(invoice);
        intent = _defaultIntent(policyId, invoiceHash, amount, nonce);
        agentSig = _signIntent(AGENT_KEY, intent);
        merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);
        (approval, ownerSig) = _emptyApproval();
    }

    function test_evaluate_validDirectPayment_returnsAllow() public {
        (
            IPayGuardVault.Invoice memory invoice,
            IPayGuardVault.PaymentIntent memory intent,
            bytes memory agentSig,
            bytes memory merchantSig,
            IPayGuardVault.ExceptionApproval memory approval,
            bytes memory ownerSig
        ) = _happyPathArgs(bytes32(uint256(1)), 50e18, 1);

        IPayGuardVault.Evaluation memory evaluation =
            vault.evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        assertEq(uint8(evaluation.decision), uint8(IPayGuardVault.Decision.ALLOW));
        assertEq(uint8(evaluation.reason), uint8(IPayGuardVault.Reason.OK));
        assertTrue(evaluation.signaturesChecked);
    }

    function test_evaluate_doesNotMoveTokensOrConsumeState() public {
        (
            IPayGuardVault.Invoice memory invoice,
            IPayGuardVault.PaymentIntent memory intent,
            bytes memory agentSig,
            bytes memory merchantSig,
            IPayGuardVault.ExceptionApproval memory approval,
            bytes memory ownerSig
        ) = _happyPathArgs(bytes32(uint256(1)), 50e18, 1);

        uint256 vaultBalanceBefore = tokenA.balanceOf(address(vault));
        vault.evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        assertEq(tokenA.balanceOf(address(vault)), vaultBalanceBefore);
        assertFalse(vault.isInvoiceConsumed(merchantRecipient, bytes32(uint256(1))));
        assertFalse(vault.isAgentNonceUsed(agent, 1));
    }

    function test_executePayment_exactMerchantDelta_measuredIO_eventCorrelation_noResidue() public {
        (
            IPayGuardVault.Invoice memory invoice,
            IPayGuardVault.PaymentIntent memory intent,
            bytes memory agentSig,
            bytes memory merchantSig,
            IPayGuardVault.ExceptionApproval memory approval,
            bytes memory ownerSig
        ) = _happyPathArgs(bytes32(uint256(1)), 50e18, 1);

        uint256 vaultBefore = tokenA.balanceOf(address(vault));
        uint256 merchantBefore = tokenA.balanceOf(merchantRecipient);
        bytes32 expectedIntentHash = vault.hashIntent(intent);
        bytes32 expectedInvoiceKey = keccak256(abi.encode(merchantRecipient, bytes32(uint256(1))));

        vm.expectEmit(true, true, true, true, address(vault));
        emit IPayGuardVault.PaymentExecuted(
            expectedIntentHash,
            policyId,
            expectedInvoiceKey,
            merchantRecipient,
            address(tokenA),
            50e18,
            address(tokenA),
            50e18,
            bytes32(0),
            0
        );

        // Any ordinary relayer may submit -- msg.sender need not equal the agent (Prompt 2 §3).
        vm.prank(other);
        (bytes32 intentHash, uint256 actualInput, uint256 subsidyAmount) =
            vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        assertEq(intentHash, expectedIntentHash);
        assertEq(actualInput, 50e18);
        assertEq(subsidyAmount, 0);
        assertEq(tokenA.balanceOf(merchantRecipient) - merchantBefore, 50e18);
        assertEq(vaultBefore - tokenA.balanceOf(address(vault)), 50e18);

        // Consumption recorded.
        assertTrue(vault.isInvoiceConsumed(merchantRecipient, bytes32(uint256(1))));
        assertTrue(vault.isAgentNonceUsed(agent, 1));

        // No leftover active execution context (direct route never touches an adapter allowance).
        IPayGuardVault.ExecutionContext memory ctx = vault.getExecutionContext();
        assertFalse(ctx.active);

        // Spend accounting reflects the actual settlement-token output.
        IPayGuardVault.PolicyState memory state = vault.getPolicyState(policyId);
        assertEq(state.outputSpent, 50e18);
        assertEq(state.inputSpent, 50e18);
    }

    function test_executePayment_notAllow_reverts_paymentRejected() public {
        (
            IPayGuardVault.Invoice memory invoice,
            IPayGuardVault.PaymentIntent memory intent,,,
            IPayGuardVault.ExceptionApproval memory approval,
            bytes memory ownerSig
        ) = _happyPathArgs(bytes32(uint256(1)), 50e18, 1);

        bytes memory badAgentSig = _signIntent(OTHER_KEY, intent); // wrong signer
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        vm.expectRevert(
            abi.encodeWithSelector(IPayGuardVault.PaymentRejected.selector, IPayGuardVault.Reason.INVALID_SIGNATURE)
        );
        vault.executePayment(invoice, intent, badAgentSig, merchantSig, approval, ownerSig);
    }
}
