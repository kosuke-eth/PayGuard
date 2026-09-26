// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PayGuardTestBase} from "./helpers/PayGuardTestBase.sol";
import {IPayGuardVault} from "../src/interfaces/IPayGuardVault.sol";

/// The consumed-invoice identity is vault + recipient + invoiceId, independent of policy
/// version, intent nonce, or transaction hash (CLAUDE.md invariant). This matrix proves that
/// identity holds even when everything else about the payment attempt changes.
contract ReplayTest is PayGuardTestBase {
    bytes32 internal policyId;

    function setUp() public {
        _baseSetUp();
        vm.prank(owner);
        policyId = vault.createPolicy(_defaultDirectPolicy(), _defaultMerchants());
        tokenA.mint(address(vault), 1_000e18);
    }

    function _submit(IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent)
        internal
        returns (IPayGuardVault.Reason)
    {
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();
        IPayGuardVault.Evaluation memory evaluation =
            vault.evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        if (evaluation.decision == IPayGuardVault.Decision.ALLOW) {
            vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        }
        return evaluation.reason;
    }

    function test_sameInvoiceSameIntent_secondSubmissionRejected() public {
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);

        assertEq(uint8(_submit(invoice, intent)), uint8(IPayGuardVault.Reason.OK));
        // Duplicate submission of the exact same (invoice, intent) pair -- an API-level retry.
        assertEq(uint8(_submit(invoice, intent)), uint8(IPayGuardVault.Reason.INVOICE_ALREADY_PAID));
    }

    function test_sameInvoice_newNonce_stillRejected() public {
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        IPayGuardVault.PaymentIntent memory intent1 = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        assertEq(uint8(_submit(invoice, intent1)), uint8(IPayGuardVault.Reason.OK));

        // A fresh intent (new nonce) for the identical already-paid invoice must still fail --
        // the invoice identity, not the nonce, is what was consumed.
        IPayGuardVault.PaymentIntent memory intent2 = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 2);
        assertEq(uint8(_submit(invoice, intent2)), uint8(IPayGuardVault.Reason.INVOICE_ALREADY_PAID));
    }

    function test_sameInvoice_newPolicy_stillRejected() public {
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        IPayGuardVault.PaymentIntent memory intent1 = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        assertEq(uint8(_submit(invoice, intent1)), uint8(IPayGuardVault.Reason.OK));

        // A brand-new policy version for the same agent still cannot re-pay the same invoice --
        // the invoice identity is vault-scoped, independent of policy version (CLAUDE.md).
        vm.prank(owner);
        bytes32 newPolicyId = vault.createPolicy(_defaultDirectPolicy(), _defaultMerchants());
        IPayGuardVault.PaymentIntent memory intent2 = _defaultIntent(newPolicyId, vault.hashInvoice(invoice), 10e18, 1);
        assertEq(uint8(_submit(invoice, intent2)), uint8(IPayGuardVault.Reason.INVOICE_ALREADY_PAID));
    }

    function test_sameInvoiceId_changedAmount_stillRejected() public {
        IPayGuardVault.Invoice memory invoice1 = _defaultInvoice(bytes32(uint256(1)), 10e18);
        IPayGuardVault.PaymentIntent memory intent1 = _defaultIntent(policyId, vault.hashInvoice(invoice1), 10e18, 1);
        assertEq(uint8(_submit(invoice1, intent1)), uint8(IPayGuardVault.Reason.OK));

        // Same invoiceId + recipient (the consumed identity), different amount and a fresh,
        // correctly re-signed invoice/intent/signature set -- still the same identity.
        IPayGuardVault.Invoice memory invoice2 = _defaultInvoice(bytes32(uint256(1)), 25e18);
        IPayGuardVault.PaymentIntent memory intent2 = _defaultIntent(policyId, vault.hashInvoice(invoice2), 25e18, 2);
        assertEq(uint8(_submit(invoice2, intent2)), uint8(IPayGuardVault.Reason.INVOICE_ALREADY_PAID));
    }

    function test_differentRecipient_sameInvoiceId_isDistinctIdentity() public {
        // The identity is vault + recipient + invoiceId -- a different recipient (a different
        // merchant snapshot) with the same raw invoiceId is a genuinely distinct identity, not a
        // replay. Register a second merchant at a different recipient address to prove it.
        IPayGuardVault.MerchantPermission[] memory merchants = new IPayGuardVault.MerchantPermission[](2);
        merchants[0] = _defaultMerchant();
        merchants[1] = IPayGuardVault.MerchantPermission({
            merchantId: keccak256("second-merchant"),
            recipient: address(0xD00D2),
            invoiceSigner: merchantSigner,
            category: 1
        });
        vm.prank(owner);
        bytes32 pid = vault.createPolicy(_defaultDirectPolicy(), merchants);

        IPayGuardVault.Invoice memory invoiceA = IPayGuardVault.Invoice({
            invoiceId: bytes32(uint256(1)),
            merchantId: MERCHANT_ID,
            recipient: merchantRecipient,
            settlementToken: address(tokenA),
            outputAmount: 10e18,
            category: 1,
            validUntil: uint48(block.timestamp + 1 days)
        });
        IPayGuardVault.PaymentIntent memory intentA = _defaultIntent(pid, vault.hashInvoice(invoiceA), 10e18, 1);
        assertEq(uint8(_submit(invoiceA, intentA)), uint8(IPayGuardVault.Reason.OK));

        IPayGuardVault.Invoice memory invoiceB = IPayGuardVault.Invoice({
            invoiceId: bytes32(uint256(1)), // same raw invoiceId
            merchantId: keccak256("second-merchant"),
            recipient: address(0xD00D2), // different recipient
            settlementToken: address(tokenA),
            outputAmount: 10e18,
            category: 1,
            validUntil: uint48(block.timestamp + 1 days)
        });
        IPayGuardVault.PaymentIntent memory intentB = _defaultIntent(pid, vault.hashInvoice(invoiceB), 10e18, 2);
        assertEq(uint8(_submit(invoiceB, intentB)), uint8(IPayGuardVault.Reason.OK));
    }

    function test_agentNonceReuse_acrossDifferentInvoices_rejected() public {
        IPayGuardVault.Invoice memory invoice1 = _defaultInvoice(bytes32(uint256(1)), 10e18);
        IPayGuardVault.PaymentIntent memory intent1 = _defaultIntent(policyId, vault.hashInvoice(invoice1), 10e18, 1);
        assertEq(uint8(_submit(invoice1, intent1)), uint8(IPayGuardVault.Reason.OK));

        IPayGuardVault.Invoice memory invoice2 = _defaultInvoice(bytes32(uint256(2)), 10e18);
        IPayGuardVault.PaymentIntent memory intent2 = _defaultIntent(policyId, vault.hashInvoice(invoice2), 10e18, 1); // same nonce
        assertEq(uint8(_submit(invoice2, intent2)), uint8(IPayGuardVault.Reason.NONCE_ALREADY_USED));
    }

    function test_concurrentSubmission_secondRelayerLosesRace() public {
        // Simulates two relayers racing the same signed (invoice, intent): both hold identical
        // valid signatures, but only the first mined transaction succeeds on-chain -- the
        // on-chain duplicate guard (not an API-level conflict response) is what stops the second.
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        vm.prank(address(0x1111));
        vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);

        vm.prank(address(0x2222));
        vm.expectRevert(
            abi.encodeWithSelector(IPayGuardVault.PaymentRejected.selector, IPayGuardVault.Reason.INVOICE_ALREADY_PAID)
        );
        vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);
    }
}
