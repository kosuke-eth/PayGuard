// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PayGuardTestBase} from "./helpers/PayGuardTestBase.sol";
import {IPayGuardVault} from "../src/interfaces/IPayGuardVault.sol";
import {PayGuardVault} from "../src/PayGuardVault.sol";

/// Negative-path matrix over evaluate(): every documented Reason short of budget/approval
/// exhaustion (those live in Budgets.t.sol / Approvals.t.sol) is exercised here, each isolated
/// so it fails for exactly the reason under test and no earlier check.
contract EvaluationNegativeTest is PayGuardTestBase {
    bytes32 internal policyId;

    function setUp() public {
        _baseSetUp();
        vm.prank(owner);
        policyId = vault.createPolicy(_defaultDirectPolicy(), _defaultMerchants());
        tokenA.mint(address(vault), 1_000e18);
    }

    function _reasonOf(
        IPayGuardVault.Invoice memory invoice,
        IPayGuardVault.PaymentIntent memory intent,
        bytes memory agentSig,
        bytes memory merchantSig
    ) internal view returns (IPayGuardVault.Reason) {
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();
        return vault.evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig).reason;
    }

    function test_wrongAgentSigner_invalidSignature() public {
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        bytes memory agentSig = _signIntent(OTHER_KEY, intent); // not the policy agent
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        assertEq(uint8(_reasonOf(invoice, intent, agentSig, merchantSig)), uint8(IPayGuardVault.Reason.INVALID_SIGNATURE));
    }

    function test_wrongMerchantSigner_invalidSignature() public {
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        // Merchant key signs a structurally different invoice (same id, different amount) --
        // hits the dedicated merchant-signature check, not the invoiceHash binding check.
        IPayGuardVault.Invoice memory signedDifferentInvoice = _defaultInvoice(bytes32(uint256(1)), 999e18);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, signedDifferentInvoice);

        assertEq(uint8(_reasonOf(invoice, intent, agentSig, merchantSig)), uint8(IPayGuardVault.Reason.INVALID_SIGNATURE));
    }

    function test_invoiceHashBinding_changedField_invalidSignature() public {
        IPayGuardVault.Invoice memory signedInvoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        bytes32 boundHash = vault.hashInvoice(signedInvoice);
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, boundHash, 10e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, signedInvoice);

        // Submit a mutated invoice (amount changed post-signing) against the original intent.
        IPayGuardVault.Invoice memory submittedInvoice = signedInvoice;
        submittedInvoice.outputAmount = 20e18;

        assertEq(
            uint8(_reasonOf(submittedInvoice, intent, agentSig, merchantSig)),
            uint8(IPayGuardVault.Reason.INVALID_SIGNATURE)
        );
    }

    function test_wrongVaultDomain_crossVaultSignature_invalidSignature() public {
        address[] memory supported = new address[](2);
        supported[0] = address(tokenA);
        supported[1] = address(tokenB);
        PayGuardVault otherVault = new PayGuardVault(owner, supported);
        vm.prank(owner);
        bytes32 otherPolicyId = otherVault.createPolicy(_defaultDirectPolicy(), _defaultMerchants());

        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        // Agent signs the intent digest as computed by otherVault's own domain (different
        // verifyingContract) -- this is a legitimate signature for otherVault, not this vault.
        IPayGuardVault.PaymentIntent memory intent =
            _defaultIntent(otherPolicyId, otherVault.hashInvoice(invoice), 10e18, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AGENT_KEY, otherVault.hashIntent(intent));
        bytes memory agentSig = abi.encodePacked(r, s, v);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        // Submitted against THIS vault, referencing this vault's own (different) policy id so the
        // invoiceHash binding still passes structurally -- only the domain-bound signature fails.
        IPayGuardVault.PaymentIntent memory localIntent =
            _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        assertEq(
            uint8(_reasonOf(invoice, localIntent, agentSig, merchantSig)), uint8(IPayGuardVault.Reason.INVALID_SIGNATURE)
        );
    }

    function test_merchantNotAllowed_unknownMerchantId() public {
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        invoice.merchantId = keccak256("unknown-merchant");
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);

        assertEq(uint8(_reasonOf(invoice, intent, agentSig, bytes(""))), uint8(IPayGuardVault.Reason.MERCHANT_NOT_ALLOWED));
    }

    function test_merchantNotAllowed_recipientMismatch() public {
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        invoice.recipient = other; // merchantId exists, but recipient doesn't match the snapshot
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);

        assertEq(uint8(_reasonOf(invoice, intent, agentSig, bytes(""))), uint8(IPayGuardVault.Reason.MERCHANT_NOT_ALLOWED));
    }

    function test_categoryMismatch() public {
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        invoice.category = 2; // merchant snapshot pinned at category 1
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        assertEq(uint8(_reasonOf(invoice, intent, agentSig, merchantSig)), uint8(IPayGuardVault.Reason.CATEGORY_MISMATCH));
    }

    function test_tokenMismatch() public {
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        invoice.settlementToken = address(tokenB); // policy pins tokenA
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        assertEq(uint8(_reasonOf(invoice, intent, agentSig, merchantSig)), uint8(IPayGuardVault.Reason.TOKEN_MISMATCH));
    }

    function test_routeMismatch() public {
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        intent.routeId = bytes32(uint256(1)); // policy pins the direct route id (0)
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        assertEq(uint8(_reasonOf(invoice, intent, agentSig, merchantSig)), uint8(IPayGuardVault.Reason.ROUTE_MISMATCH));
    }

    function test_zeroAmount_invalidAmount() public {
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 0);
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, vault.hashInvoice(invoice), 0, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        assertEq(uint8(_reasonOf(invoice, intent, agentSig, merchantSig)), uint8(IPayGuardVault.Reason.INVALID_AMOUNT));
    }

    function test_oversizedAmount_aboveEscalationCeiling() public {
        // Widen maxInputPerPayment so it does not shadow the escalation-ceiling check: the
        // default policy's maxInputPerPayment (200e18) sits below its escalationOutputCap
        // (300e18) and would otherwise trip MAX_INPUT_LIMIT first for any amount large enough
        // to also exceed the escalation ceiling.
        IPayGuardVault.PolicyConfig memory config = _defaultDirectPolicy();
        config.maxInputPerPayment = config.totalInputBudget;
        vm.prank(owner);
        bytes32 widePolicyId = vault.createPolicy(config, _defaultMerchants());

        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 301e18);
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(widePolicyId, vault.hashInvoice(invoice), 301e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        assertEq(
            uint8(_reasonOf(invoice, intent, agentSig, merchantSig)), uint8(IPayGuardVault.Reason.ABOVE_ESCALATION_CEILING)
        );
    }

    function test_policyNotYetValid_expired() public {
        IPayGuardVault.PolicyConfig memory config = _defaultDirectPolicy();
        config.validAfter = uint48(block.timestamp + 1 days);
        vm.prank(owner);
        bytes32 futurePolicyId = vault.createPolicy(config, _defaultMerchants());

        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        IPayGuardVault.PaymentIntent memory intent =
            _defaultIntent(futurePolicyId, vault.hashInvoice(invoice), 10e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        assertEq(uint8(_reasonOf(invoice, intent, agentSig, merchantSig)), uint8(IPayGuardVault.Reason.EXPIRED));
    }

    function test_policyExpired() public {
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        vm.warp(block.timestamp + 31 days); // past the default policy's 30-day validUntil
        assertEq(uint8(_reasonOf(invoice, intent, agentSig, merchantSig)), uint8(IPayGuardVault.Reason.EXPIRED));
    }

    function test_invoiceExpired() public {
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        invoice.validUntil = uint48(block.timestamp); // will be strictly in the past after warp
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        vm.warp(block.timestamp + 1);
        assertEq(uint8(_reasonOf(invoice, intent, agentSig, merchantSig)), uint8(IPayGuardVault.Reason.EXPIRED));
    }

    function test_intentExpired() public {
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        intent.validUntil = uint48(block.timestamp);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        vm.warp(block.timestamp + 1);
        assertEq(uint8(_reasonOf(invoice, intent, agentSig, merchantSig)), uint8(IPayGuardVault.Reason.EXPIRED));
    }

    function test_agentRevoked() public {
        vm.prank(owner);
        vault.revokeAgent(agent);

        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        assertEq(uint8(_reasonOf(invoice, intent, agentSig, merchantSig)), uint8(IPayGuardVault.Reason.AGENT_REVOKED));
    }

    function test_inactivePolicy_nonexistent() public {
        bytes32 fakePolicyId = keccak256("does-not-exist");
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(fakePolicyId, vault.hashInvoice(invoice), 10e18, 1);

        assertEq(
            uint8(_reasonOf(invoice, intent, bytes(""), bytes(""))), uint8(IPayGuardVault.Reason.INACTIVE_POLICY)
        );
    }

    function test_inactivePolicy_revoked() public {
        vm.prank(owner);
        vault.revokePolicy(policyId);

        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        assertEq(uint8(_reasonOf(invoice, intent, agentSig, merchantSig)), uint8(IPayGuardVault.Reason.INACTIVE_POLICY));
    }

    function test_inactivePolicy_superseded() public {
        // SPEC-001: a second createPolicy for the same agent overwrites the single active slot.
        vm.prank(owner);
        vault.createPolicy(_defaultDirectPolicy(), _defaultMerchants());

        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 10e18);
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(policyId, vault.hashInvoice(invoice), 10e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        assertEq(uint8(_reasonOf(invoice, intent, agentSig, merchantSig)), uint8(IPayGuardVault.Reason.INACTIVE_POLICY));
    }
}
