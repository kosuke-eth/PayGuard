// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * Stage 2 requirement (Prompt 2 test matrix): "Shared TypeScript/Solidity hash vectors, signature
 * validation, and boundary widths. Expected results must include independent contract
 * observations." Stage 1's Eip712Vectors.t.sol already cross-validated the hand-rolled
 * Eip712HashHarness against the TypeScript (viem hashTypedData) vectors at a fixed test domain.
 * This file adds the second independent contract observation: the REAL deployed PayGuardVault's
 * own production hashInvoice/hashIntent/hashApproval, under its own live (block.chainid, address)
 * domain -- not the harness's fixed test domain -- still agree with the harness field-for-field.
 * Transitively: vault digest == harness digest == TS digest, proven via two independent Solidity
 * implementations rather than one contract importing the other's logic.
 */

import {Test} from "forge-std/Test.sol";
import {PayGuardVault} from "../src/PayGuardVault.sol";
import {IPayGuardVault} from "../src/interfaces/IPayGuardVault.sol";
import {Eip712HashHarness} from "../src/test-harness/Eip712HashHarness.sol";

contract VaultEip712CrossCheckTest is Test {
    PayGuardVault internal vault;
    Eip712HashHarness internal harness;

    function setUp() public {
        address[] memory supported = new address[](0);
        vault = new PayGuardVault(address(0xDEAD), supported);
        harness = new Eip712HashHarness();
    }

    function _invoice() internal pure returns (IPayGuardVault.Invoice memory) {
        return IPayGuardVault.Invoice({
            invoiceId: bytes32(uint256(0x1111)),
            merchantId: bytes32(uint256(0x2222)),
            recipient: address(0x00000000000000000000000000000000A1A1A1),
            settlementToken: address(0x00000000000000000000000000000000B1B1B1),
            outputAmount: 500000,
            category: 3,
            validUntil: 2000000000
        });
    }

    function _harnessInvoice() internal pure returns (Eip712HashHarness.Invoice memory) {
        IPayGuardVault.Invoice memory invoice = _invoice();
        return Eip712HashHarness.Invoice({
            invoiceId: invoice.invoiceId,
            merchantId: invoice.merchantId,
            recipient: invoice.recipient,
            settlementToken: invoice.settlementToken,
            outputAmount: invoice.outputAmount,
            category: invoice.category,
            validUntil: invoice.validUntil
        });
    }

    function _intent(bytes32 invoiceHash) internal pure returns (IPayGuardVault.PaymentIntent memory) {
        return IPayGuardVault.PaymentIntent({
            policyId: bytes32(uint256(0x3333)),
            invoiceHash: invoiceHash,
            routeId: bytes32(uint256(0x5555)),
            maxInputAmount: 2600000000000000,
            nonce: 1,
            validUntil: 2000000000,
            subsidyMode: IPayGuardVault.SubsidyMode.NONE,
            maxSubsidyAmount: 0
        });
    }

    function _harnessIntent(bytes32 invoiceHash) internal pure returns (Eip712HashHarness.PaymentIntent memory) {
        IPayGuardVault.PaymentIntent memory intent = _intent(invoiceHash);
        return Eip712HashHarness.PaymentIntent({
            policyId: intent.policyId,
            invoiceHash: intent.invoiceHash,
            routeId: intent.routeId,
            maxInputAmount: intent.maxInputAmount,
            nonce: intent.nonce,
            validUntil: intent.validUntil,
            subsidyMode: uint8(intent.subsidyMode),
            maxSubsidyAmount: intent.maxSubsidyAmount
        });
    }

    function _approval(bytes32 intentHash) internal pure returns (IPayGuardVault.ExceptionApproval memory) {
        return IPayGuardVault.ExceptionApproval({intentHash: intentHash, nonce: 12345, validUntil: 2000000000});
    }

    function _harnessApproval(bytes32 intentHash) internal pure returns (Eip712HashHarness.ExceptionApproval memory) {
        return Eip712HashHarness.ExceptionApproval({intentHash: intentHash, nonce: 12345, validUntil: 2000000000});
    }

    function test_vaultInvoiceDigest_matchesIndependentHarness() public view {
        bytes32 vaultDigest = vault.hashInvoice(_invoice());
        bytes32 harnessDigest = harness.hashInvoice(block.chainid, address(vault), _harnessInvoice());
        assertEq(vaultDigest, harnessDigest, "vault and harness Invoice digests diverge");
    }

    function test_vaultIntentDigest_matchesIndependentHarness() public view {
        bytes32 invoiceHash = vault.hashInvoice(_invoice());
        bytes32 vaultDigest = vault.hashIntent(_intent(invoiceHash));
        bytes32 harnessDigest = harness.hashIntent(block.chainid, address(vault), _harnessIntent(invoiceHash));
        assertEq(vaultDigest, harnessDigest, "vault and harness PaymentIntent digests diverge");
    }

    function test_vaultApprovalDigest_matchesIndependentHarness() public view {
        bytes32 invoiceHash = vault.hashInvoice(_invoice());
        bytes32 intentHash = vault.hashIntent(_intent(invoiceHash));
        bytes32 vaultDigest = vault.hashApproval(_approval(intentHash));
        bytes32 harnessDigest = harness.hashApproval(block.chainid, address(vault), _harnessApproval(intentHash));
        assertEq(vaultDigest, harnessDigest, "vault and harness ExceptionApproval digests diverge");
    }

    function test_vaultDigest_changedField_divergesInBothConsistently() public view {
        IPayGuardVault.Invoice memory invoice = _invoice();
        Eip712HashHarness.Invoice memory harnessInvoice = _harnessInvoice();

        bytes32 vaultBase = vault.hashInvoice(invoice);
        bytes32 harnessBase = harness.hashInvoice(block.chainid, address(vault), harnessInvoice);
        assertEq(vaultBase, harnessBase);

        invoice.outputAmount = 500001;
        harnessInvoice.outputAmount = 500001;
        bytes32 vaultChanged = vault.hashInvoice(invoice);
        bytes32 harnessChanged = harness.hashInvoice(block.chainid, address(vault), harnessInvoice);

        assertTrue(vaultChanged != vaultBase, "vault digest did not change with outputAmount");
        assertEq(vaultChanged, harnessChanged, "vault and harness diverge on the changed-field digest too");
    }

    function test_vaultDigest_wrongVerifyingContract_diverges() public view {
        bytes32 vaultDigest = vault.hashInvoice(_invoice());
        // Same field values, but hashed under a different verifyingContract -- must not collide.
        bytes32 harnessDigestWrongContract =
            harness.hashInvoice(block.chainid, address(0xBEEF), _harnessInvoice());
        assertTrue(vaultDigest != harnessDigestWrongContract, "domain separation by verifyingContract failed");
    }
}
