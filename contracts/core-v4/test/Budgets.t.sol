// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PayGuardTestBase} from "./helpers/PayGuardTestBase.sol";
import {IPayGuardVault} from "../src/interfaces/IPayGuardVault.sol";

/// Isolates each hard budget/limit check (Reason enum TOTAL_OUTPUT_BUDGET / EPOCH_OUTPUT_BUDGET /
/// INPUT_BUDGET / MAX_INPUT_LIMIT) plus epoch rollover, and separately proves settlement-token
/// output accounting is never conflated with input-token exposure accounting (CLAUDE.md
/// invariant: never compare/sum output-token and input-token units as one budget).
contract BudgetsTest is PayGuardTestBase {
    function _createPolicy(IPayGuardVault.PolicyConfig memory config) internal returns (bytes32 id) {
        vm.prank(owner);
        id = vault.createPolicy(config, _defaultMerchants());
    }

    function _pay(bytes32 policyId, bytes32 invoiceId, uint256 outputAmount, uint256 maxInputAmount, uint256 nonce)
        internal
        returns (IPayGuardVault.Reason)
    {
        IPayGuardVault.Invoice memory invoice = _defaultInvoice(invoiceId, outputAmount);
        IPayGuardVault.PaymentIntent memory intent =
            _defaultIntent(policyId, vault.hashInvoice(invoice), maxInputAmount, nonce);
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

    function setUp() public {
        _baseSetUp();
        tokenA.mint(address(vault), 10_000e18);
    }

    function test_totalOutputBudget_exceeded() public {
        IPayGuardVault.PolicyConfig memory config = _defaultDirectPolicy();
        config.totalOutputBudget = 100e18;
        config.epochOutputBudget = 100e18;
        config.automaticOutputCap = 100e18;
        config.escalationOutputCap = 100e18;
        bytes32 policyId = _createPolicy(config);

        assertEq(uint8(_pay(policyId, bytes32(uint256(1)), 100e18, 100e18, 1)), uint8(IPayGuardVault.Reason.OK));
        assertEq(
            uint8(_pay(policyId, bytes32(uint256(2)), 1e18, 1e18, 2)),
            uint8(IPayGuardVault.Reason.TOTAL_OUTPUT_BUDGET)
        );
    }

    function test_epochOutputBudget_exceeded_withoutTrippingTotalBudget() public {
        IPayGuardVault.PolicyConfig memory config = _defaultDirectPolicy();
        config.totalOutputBudget = 1_000e18;
        config.epochOutputBudget = 60e18;
        config.automaticOutputCap = 1_000e18;
        config.escalationOutputCap = 1_000e18;
        bytes32 policyId = _createPolicy(config);

        assertEq(uint8(_pay(policyId, bytes32(uint256(1)), 60e18, 60e18, 1)), uint8(IPayGuardVault.Reason.OK));
        assertEq(
            uint8(_pay(policyId, bytes32(uint256(2)), 1e18, 1e18, 2)),
            uint8(IPayGuardVault.Reason.EPOCH_OUTPUT_BUDGET)
        );

        IPayGuardVault.PolicyState memory state = vault.getPolicyState(policyId);
        assertEq(state.outputSpent, 60e18); // the rejected attempt never wrote state
    }

    function test_epochRollover_resetsEpochBudget() public {
        IPayGuardVault.PolicyConfig memory config = _defaultDirectPolicy();
        config.totalOutputBudget = 1_000e18;
        config.epochOutputBudget = 60e18;
        config.automaticOutputCap = 1_000e18;
        config.escalationOutputCap = 1_000e18;
        bytes32 policyId = _createPolicy(config);

        assertEq(uint8(_pay(policyId, bytes32(uint256(1)), 60e18, 60e18, 1)), uint8(IPayGuardVault.Reason.OK));
        assertEq(
            uint8(_pay(policyId, bytes32(uint256(2)), 1e18, 1e18, 2)),
            uint8(IPayGuardVault.Reason.EPOCH_OUTPUT_BUDGET)
        );

        vm.warp(block.timestamp + 1 days); // next epoch
        assertEq(uint8(_pay(policyId, bytes32(uint256(3)), 60e18, 60e18, 3)), uint8(IPayGuardVault.Reason.OK));

        IPayGuardVault.PolicyState memory state = vault.getPolicyState(policyId);
        assertEq(state.outputSpent, 120e18); // lifetime total keeps accumulating across epochs
        assertEq(state.epochOutputSpent, 60e18); // but the new epoch's own counter starts fresh
    }

    function test_inputBudget_exceeded_isolatedFromOutputBudget() public {
        IPayGuardVault.PolicyConfig memory config = _defaultDirectPolicy();
        config.totalOutputBudget = 1_000e18;
        config.epochOutputBudget = 1_000e18;
        config.automaticOutputCap = 1_000e18;
        config.escalationOutputCap = 1_000e18;
        config.totalInputBudget = 50e18;
        config.maxInputPerPayment = 50e18; // config validation requires maxInputPerPayment <= totalInputBudget
        bytes32 policyId = _createPolicy(config);

        // Small output amount, but a high signed input ceiling that alone exceeds the input budget
        // -- proves input-token exposure is tracked independently of settlement-token output.
        assertEq(
            uint8(_pay(policyId, bytes32(uint256(1)), 10e18, 60e18, 1)), uint8(IPayGuardVault.Reason.INPUT_BUDGET)
        );
    }

    function test_maxInputPerPayment_exceeded_isolatedFromInputBudget() public {
        IPayGuardVault.PolicyConfig memory config = _defaultDirectPolicy();
        config.totalOutputBudget = 1_000e18;
        config.epochOutputBudget = 1_000e18;
        config.automaticOutputCap = 1_000e18;
        config.escalationOutputCap = 1_000e18;
        config.totalInputBudget = 1_000e18;
        config.maxInputPerPayment = 50e18;
        bytes32 policyId = _createPolicy(config);

        assertEq(
            uint8(_pay(policyId, bytes32(uint256(1)), 10e18, 60e18, 1)), uint8(IPayGuardVault.Reason.MAX_INPUT_LIMIT)
        );
    }

    function test_inputReservation_refundedToActualUsage_directRoute() public {
        // Direct route: actualInput == outputAmount always. The signed maxInputAmount ceiling
        // (60e18) is reserved in-transaction then refunded down to the actual 10e18 spent.
        IPayGuardVault.PolicyConfig memory config = _defaultDirectPolicy();
        config.totalInputBudget = 1_000e18;
        config.maxInputPerPayment = 1_000e18;
        bytes32 policyId = _createPolicy(config);

        assertEq(uint8(_pay(policyId, bytes32(uint256(1)), 10e18, 60e18, 1)), uint8(IPayGuardVault.Reason.OK));

        IPayGuardVault.PolicyState memory state = vault.getPolicyState(policyId);
        assertEq(state.inputSpent, 10e18); // not 60e18 -- refunded to actual usage
    }
}
