// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PayGuardTestBase} from "./helpers/PayGuardTestBase.sol";
import {IPayGuardVault} from "../src/interfaces/IPayGuardVault.sol";
import {MockERC1271Owner} from "./fixtures/MockERC1271Owner.sol";
import {PayGuardVault} from "../src/PayGuardVault.sol";

/// Exception-approval matrix: an owner approval bypasses only automaticOutputCap, up to
/// escalationOutputCap, and never any hard rule (CLAUDE.md invariant). Also covers ERC-1271
/// smart-contract owners (SignatureChecker's EOA+contract path) and the zero-approval convention.
contract ApprovalsTest is PayGuardTestBase {
    bytes32 internal policyId;

    function setUp() public {
        _baseSetUp();
        vm.prank(owner);
        policyId = vault.createPolicy(_defaultDirectPolicy(), _defaultMerchants());
        tokenA.mint(address(vault), 1_000e18);
    }

    function _invoiceAndIntent(bytes32 invoiceId, uint256 amount, uint256 nonce)
        internal
        view
        returns (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent)
    {
        invoice = _defaultInvoice(invoiceId, amount);
        intent = _defaultIntent(policyId, vault.hashInvoice(invoice), amount, nonce);
    }

    function test_belowAutomaticCap_needsNoApproval() public {
        // Default automaticOutputCap = 100e18.
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(1)), 50e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        IPayGuardVault.Evaluation memory evaluation =
            vault.evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        assertEq(uint8(evaluation.decision), uint8(IPayGuardVault.Decision.ALLOW));
    }

    function test_aboveAutomaticCap_noApproval_escalates() public {
        // 150e18 is above automaticOutputCap (100e18) but below escalationOutputCap (300e18).
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(1)), 150e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);
        (IPayGuardVault.ExceptionApproval memory approval, bytes memory ownerSig) = _emptyApproval();

        IPayGuardVault.Evaluation memory evaluation =
            vault.evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        assertEq(uint8(evaluation.decision), uint8(IPayGuardVault.Decision.ESCALATE));
        assertEq(uint8(evaluation.reason), uint8(IPayGuardVault.Reason.APPROVAL_REQUIRED));
    }

    function test_aboveAutomaticCap_validOwnerApproval_allows() public {
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(1)), 150e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        bytes32 intentHash = vault.hashIntent(intent);
        IPayGuardVault.ExceptionApproval memory approval =
            IPayGuardVault.ExceptionApproval({intentHash: intentHash, nonce: 1, validUntil: uint48(block.timestamp + 1 hours)});
        bytes memory ownerSig = _signApproval(OWNER_KEY, approval);

        vm.prank(other);
        (bytes32 returnedHash,,) = vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        assertEq(returnedHash, intentHash);
        assertTrue(vault.isApprovalNonceUsedOrCancelled(1));
    }

    function test_approval_cannotBypassEscalationCeiling() public {
        // 301e18 exceeds escalationOutputCap (300e18) -- a hard rule no approval can move
        // (default maxInputPerPayment is raised so MAX_INPUT_LIMIT doesn't shadow the check).
        IPayGuardVault.PolicyConfig memory config = _defaultDirectPolicy();
        config.maxInputPerPayment = config.totalInputBudget;
        vm.prank(owner);
        bytes32 widePolicyId = vault.createPolicy(config, _defaultMerchants());

        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 301e18);
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(widePolicyId, vault.hashInvoice(invoice), 301e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        bytes32 intentHash = vault.hashIntent(intent);
        IPayGuardVault.ExceptionApproval memory approval =
            IPayGuardVault.ExceptionApproval({intentHash: intentHash, nonce: 1, validUntil: uint48(block.timestamp + 1 hours)});
        bytes memory ownerSig = _signApproval(OWNER_KEY, approval);

        IPayGuardVault.Evaluation memory evaluation =
            vault.evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        assertEq(uint8(evaluation.decision), uint8(IPayGuardVault.Decision.BLOCK));
        assertEq(uint8(evaluation.reason), uint8(IPayGuardVault.Reason.ABOVE_ESCALATION_CEILING));
    }

    function test_approval_cannotBypassTotalOutputBudget() public {
        // Escalation-eligible amount, but the total output budget alone is the binding hard rule.
        IPayGuardVault.PolicyConfig memory config = _defaultDirectPolicy();
        config.totalOutputBudget = 50e18; // below the 150e18 payment even with a valid approval
        config.epochOutputBudget = 50e18;
        config.automaticOutputCap = 50e18;
        config.escalationOutputCap = 50e18; // must stay <= totalOutputBudget for a valid config
        vm.prank(owner);
        bytes32 tightPolicyId = vault.createPolicy(config, _defaultMerchants());

        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 150e18);
        IPayGuardVault.PaymentIntent memory intent = _defaultIntent(tightPolicyId, vault.hashInvoice(invoice), 150e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        bytes32 intentHash = vault.hashIntent(intent);
        IPayGuardVault.ExceptionApproval memory approval =
            IPayGuardVault.ExceptionApproval({intentHash: intentHash, nonce: 1, validUntil: uint48(block.timestamp + 1 hours)});
        bytes memory ownerSig = _signApproval(OWNER_KEY, approval);

        IPayGuardVault.Evaluation memory evaluation =
            vault.evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        assertEq(uint8(evaluation.reason), uint8(IPayGuardVault.Reason.TOTAL_OUTPUT_BUDGET));
    }

    function test_approval_wrongOwnerSigner_invalidApproval() public {
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(1)), 150e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        bytes32 intentHash = vault.hashIntent(intent);
        IPayGuardVault.ExceptionApproval memory approval =
            IPayGuardVault.ExceptionApproval({intentHash: intentHash, nonce: 1, validUntil: uint48(block.timestamp + 1 hours)});
        bytes memory ownerSig = _signApproval(OTHER_KEY, approval); // not the owner

        IPayGuardVault.Evaluation memory evaluation =
            vault.evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        assertEq(uint8(evaluation.reason), uint8(IPayGuardVault.Reason.INVALID_APPROVAL));
    }

    function test_approval_expired_invalidApproval() public {
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(1)), 150e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        bytes32 intentHash = vault.hashIntent(intent);
        IPayGuardVault.ExceptionApproval memory approval =
            IPayGuardVault.ExceptionApproval({intentHash: intentHash, nonce: 1, validUntil: uint48(block.timestamp)});
        bytes memory ownerSig = _signApproval(OWNER_KEY, approval);

        vm.warp(block.timestamp + 1);
        IPayGuardVault.Evaluation memory evaluation =
            vault.evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        assertEq(uint8(evaluation.reason), uint8(IPayGuardVault.Reason.INVALID_APPROVAL));
    }

    function test_approval_mutatedIntentHash_invalidApproval() public {
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(1)), 150e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        // Approval signed for a different intent hash than the one actually submitted.
        IPayGuardVault.ExceptionApproval memory approval = IPayGuardVault.ExceptionApproval({
            intentHash: keccak256("not-this-intent"),
            nonce: 1,
            validUntil: uint48(block.timestamp + 1 hours)
        });
        bytes memory ownerSig = _signApproval(OWNER_KEY, approval);

        IPayGuardVault.Evaluation memory evaluation =
            vault.evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        assertEq(uint8(evaluation.reason), uint8(IPayGuardVault.Reason.INVALID_APPROVAL));
    }

    function test_approval_cancelledByOwner_invalidApproval() public {
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(1)), 150e18, 1);
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        bytes32 intentHash = vault.hashIntent(intent);
        IPayGuardVault.ExceptionApproval memory approval =
            IPayGuardVault.ExceptionApproval({intentHash: intentHash, nonce: 1, validUntil: uint48(block.timestamp + 1 hours)});
        bytes memory ownerSig = _signApproval(OWNER_KEY, approval);

        // "Capacity consumed after the owner signs but before execution": owner cancels the
        // nonce post-signature, e.g. because circumstances changed.
        vm.prank(owner);
        vault.cancelApprovalNonce(1);

        IPayGuardVault.Evaluation memory evaluation =
            vault.evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        assertEq(uint8(evaluation.reason), uint8(IPayGuardVault.Reason.INVALID_APPROVAL));
    }

    function test_approval_reuseAcrossTwoPayments_secondRejected() public {
        (IPayGuardVault.Invoice memory invoice1, IPayGuardVault.PaymentIntent memory intent1) =
            _invoiceAndIntent(bytes32(uint256(1)), 150e18, 1);
        bytes memory agentSig1 = _signIntent(AGENT_KEY, intent1);
        bytes memory merchantSig1 = _signInvoice(MERCHANT_SIGNER_KEY, invoice1);
        bytes32 intentHash1 = vault.hashIntent(intent1);
        IPayGuardVault.ExceptionApproval memory approval1 =
            IPayGuardVault.ExceptionApproval({intentHash: intentHash1, nonce: 9, validUntil: uint48(block.timestamp + 1 hours)});
        bytes memory ownerSig1 = _signApproval(OWNER_KEY, approval1);
        vault.executePayment(invoice1, intent1, agentSig1, merchantSig1, approval1, ownerSig1);

        // A second, distinct payment tries to reuse the same approval nonce with a
        // differently-signed approval whose intentHash field is forced to match anyway.
        (IPayGuardVault.Invoice memory invoice2, IPayGuardVault.PaymentIntent memory intent2) =
            _invoiceAndIntent(bytes32(uint256(2)), 150e18, 2);
        bytes memory agentSig2 = _signIntent(AGENT_KEY, intent2);
        bytes memory merchantSig2 = _signInvoice(MERCHANT_SIGNER_KEY, invoice2);
        bytes32 intentHash2 = vault.hashIntent(intent2);
        IPayGuardVault.ExceptionApproval memory approval2 =
            IPayGuardVault.ExceptionApproval({intentHash: intentHash2, nonce: 9, validUntil: uint48(block.timestamp + 1 hours)});
        bytes memory ownerSig2 = _signApproval(OWNER_KEY, approval2);

        IPayGuardVault.Evaluation memory evaluation =
            vault.evaluate(invoice2, intent2, agentSig2, merchantSig2, approval2, ownerSig2);
        assertEq(uint8(evaluation.reason), uint8(IPayGuardVault.Reason.INVALID_APPROVAL));
    }

    function test_erc1271OwnerApproval_validContractSignature_allows() public {
        MockERC1271Owner contractOwner = new MockERC1271Owner(vm.addr(OWNER_KEY));
        address[] memory supported = new address[](2);
        supported[0] = address(tokenA);
        supported[1] = address(tokenB);
        PayGuardVault contractOwnedVault = new PayGuardVault(address(contractOwner), supported);
        tokenA.mint(address(contractOwnedVault), 1_000e18);

        vm.prank(address(contractOwner));
        bytes32 pid = contractOwnedVault.createPolicy(_defaultDirectPolicy(), _defaultMerchants());

        IPayGuardVault.Invoice memory invoice = _defaultInvoice(bytes32(uint256(1)), 150e18);
        IPayGuardVault.PaymentIntent memory intent =
            _defaultIntent(pid, contractOwnedVault.hashInvoice(invoice), 150e18, 1);
        bytes memory agentSig = _sign(AGENT_KEY, contractOwnedVault.hashIntent(intent));
        bytes memory merchantSig = _sign(MERCHANT_SIGNER_KEY, contractOwnedVault.hashInvoice(invoice));

        bytes32 intentHash = contractOwnedVault.hashIntent(intent);
        IPayGuardVault.ExceptionApproval memory approval =
            IPayGuardVault.ExceptionApproval({intentHash: intentHash, nonce: 1, validUntil: uint48(block.timestamp + 1 hours)});
        // Signed by the EOA the mock ERC-1271 contract recognizes as authorized -- the vault
        // verifies via SignatureChecker.isValidSignatureNow against the CONTRACT owner address.
        bytes memory ownerSig = _sign(OWNER_KEY, contractOwnedVault.hashApproval(approval));

        IPayGuardVault.Evaluation memory evaluation =
            contractOwnedVault.evaluate(invoice, intent, agentSig, merchantSig, approval, ownerSig);
        assertEq(uint8(evaluation.decision), uint8(IPayGuardVault.Decision.ALLOW));
    }

    function test_nonEmptyApprovalOnNonEscalatedPayment_stillValidated() public {
        // SPEC-002: malformed/garbage "optional" approval data on a payment that doesn't need
        // one must not be silently ignored -- it is still fully validated.
        (IPayGuardVault.Invoice memory invoice, IPayGuardVault.PaymentIntent memory intent) =
            _invoiceAndIntent(bytes32(uint256(1)), 50e18, 1); // below automaticOutputCap
        bytes memory agentSig = _signIntent(AGENT_KEY, intent);
        bytes memory merchantSig = _signInvoice(MERCHANT_SIGNER_KEY, invoice);

        IPayGuardVault.ExceptionApproval memory garbageApproval = IPayGuardVault.ExceptionApproval({
            intentHash: keccak256("garbage"),
            nonce: 42,
            validUntil: uint48(block.timestamp + 1 hours)
        });
        bytes memory garbageOwnerSig = _signApproval(OWNER_KEY, garbageApproval);

        IPayGuardVault.Evaluation memory evaluation =
            vault.evaluate(invoice, intent, agentSig, merchantSig, garbageApproval, garbageOwnerSig);
        assertEq(uint8(evaluation.reason), uint8(IPayGuardVault.Reason.INVALID_APPROVAL));
    }
}
