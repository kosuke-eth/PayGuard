// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PayGuardVault} from "../../src/PayGuardVault.sol";
import {IPayGuardVault} from "../../src/interfaces/IPayGuardVault.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

/// Stateful fuzz handler: mixes successful direct-route payments with intentionally-invalid
/// replay attempts and unauthorized owner-action attempts, tracking an independent ghost ledger
/// the invariant test cross-checks against the vault's own on-chain accounting. Per Prompt 2's
/// test requirement, successful executions are the common case here, not just reverts -- a
/// handler where every call reverts would prove nothing.
contract PayGuardHandler is Test {
    PayGuardVault public immutable vault;
    MockERC20 public immutable token;
    bytes32 public immutable policyId;
    bytes32 public immutable merchantId;
    address public immutable merchantRecipient;
    uint256 internal immutable agentKey;
    uint256 internal immutable merchantKey;

    uint256 public ghostOutputPaid;
    uint256 public ghostSuccessCount;
    uint256 public ghostRejectedReplayCount;
    uint256 public ghostRejectedUnauthorizedCount;
    uint256 internal nextInvoiceSeq;
    bytes32[] internal consumedInvoiceIds;

    constructor(
        PayGuardVault _vault,
        MockERC20 _token,
        bytes32 _policyId,
        bytes32 _merchantId,
        address _merchantRecipient,
        uint256 _agentKey,
        uint256 _merchantKey
    ) {
        vault = _vault;
        token = _token;
        policyId = _policyId;
        merchantId = _merchantId;
        merchantRecipient = _merchantRecipient;
        agentKey = _agentKey;
        merchantKey = _merchantKey;
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function executeValidPayment(uint256 amountSeed) external {
        IPayGuardVault.PolicyConfig memory config = vault.getPolicy(policyId);
        IPayGuardVault.PolicyState memory state = vault.getPolicyState(policyId);

        uint256 remainingTotal = config.totalOutputBudget > state.outputSpent ? config.totalOutputBudget - state.outputSpent : 0;
        uint256 remainingEpoch =
            config.epochOutputBudget > state.epochOutputSpent ? config.epochOutputBudget - state.epochOutputSpent : 0;
        uint256 cap = remainingTotal < remainingEpoch ? remainingTotal : remainingEpoch;
        if (cap == 0) return;

        uint256 amount = 1 + (amountSeed % cap);
        if (token.balanceOf(address(vault)) < amount) return;

        bytes32 invoiceId = keccak256(abi.encode("handler-invoice", nextInvoiceSeq++));
        IPayGuardVault.Invoice memory invoice = IPayGuardVault.Invoice({
            invoiceId: invoiceId,
            merchantId: merchantId,
            recipient: merchantRecipient,
            settlementToken: config.settlementToken,
            outputAmount: amount,
            category: 1,
            validUntil: uint48(block.timestamp + 1 days)
        });
        IPayGuardVault.PaymentIntent memory intent = IPayGuardVault.PaymentIntent({
            policyId: policyId,
            invoiceHash: vault.hashInvoice(invoice),
            routeId: bytes32(0),
            maxInputAmount: amount,
            nonce: nextInvoiceSeq,
            validUntil: uint48(block.timestamp + 1 hours),
            subsidyMode: IPayGuardVault.SubsidyMode.NONE,
            maxSubsidyAmount: 0
        });
        bytes memory agentSig = _sign(agentKey, vault.hashIntent(intent));
        bytes memory merchantSig = _sign(merchantKey, vault.hashInvoice(invoice));
        IPayGuardVault.ExceptionApproval memory approval;
        bytes memory ownerSig;

        try vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig) {
            ghostOutputPaid += amount;
            ghostSuccessCount += 1;
            consumedInvoiceIds.push(invoiceId);
        } catch {
            // Budget/epoch races between the cap computed above and execution (none expected in
            // this single-threaded handler, but tolerated defensively) are not counted as bugs.
        }
    }

    function attemptReplayConsumedInvoice(uint256 pickSeed) external {
        if (consumedInvoiceIds.length == 0) return;
        bytes32 invoiceId = consumedInvoiceIds[pickSeed % consumedInvoiceIds.length];

        IPayGuardVault.PolicyConfig memory config = vault.getPolicy(policyId);
        // Same invoice identity, a fresh nonce/intent -- must still be rejected as already paid.
        IPayGuardVault.Invoice memory invoice = IPayGuardVault.Invoice({
            invoiceId: invoiceId,
            merchantId: merchantId,
            recipient: merchantRecipient,
            settlementToken: config.settlementToken,
            outputAmount: 1,
            category: 1,
            validUntil: uint48(block.timestamp + 1 days)
        });
        IPayGuardVault.PaymentIntent memory intent = IPayGuardVault.PaymentIntent({
            policyId: policyId,
            invoiceHash: vault.hashInvoice(invoice),
            routeId: bytes32(0),
            maxInputAmount: 1,
            nonce: type(uint256).max - nextInvoiceSeq++,
            validUntil: uint48(block.timestamp + 1 hours),
            subsidyMode: IPayGuardVault.SubsidyMode.NONE,
            maxSubsidyAmount: 0
        });
        bytes memory agentSig = _sign(agentKey, vault.hashIntent(intent));
        bytes memory merchantSig = _sign(merchantKey, vault.hashInvoice(invoice));
        IPayGuardVault.ExceptionApproval memory approval;
        bytes memory ownerSig;

        uint256 outputSpentBefore = vault.getPolicyState(policyId).outputSpent;
        try vault.executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig) {
            revert("handler invariant setup bug: replay unexpectedly succeeded");
        } catch {
            ghostRejectedReplayCount += 1;
            assert(vault.getPolicyState(policyId).outputSpent == outputSpentBefore);
        }
    }

    function attemptUnauthorizedOwnerAction(uint256 seed) external {
        uint256 outputSpentBefore = vault.getPolicyState(policyId).outputSpent;
        bool paused = seed % 2 == 0;
        try vault.setExecutionPaused(paused) {
            revert("handler invariant setup bug: unauthorized pause unexpectedly succeeded");
        } catch {
            ghostRejectedUnauthorizedCount += 1;
        }
        assert(vault.getPolicyState(policyId).outputSpent == outputSpentBefore);
    }

    function consumedInvoiceCount() external view returns (uint256) {
        return consumedInvoiceIds.length;
    }
}
