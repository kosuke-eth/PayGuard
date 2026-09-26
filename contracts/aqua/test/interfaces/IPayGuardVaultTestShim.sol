// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * Test-only ABI-only shim (see src/interfaces/IPayGuardSettlementAdapterShim.sol for the
 * production-facing rationale) covering the FULL IPayGuardVault surface the B4 test suite
 * orchestrates against (deposit/createPolicy/evaluate/executePayment/hashInvoice/hashIntent/
 * getPolicyState/getExecutionContext) -- field-for-field identical to
 * contracts/core-v4/src/interfaces/IPayGuardVault.sol, verified by
 * script/check-abi-equivalence.mjs (extended to also cover the functions this file adds).
 * Never imported by the production adapter itself -- test orchestration only.
 */
interface IPayGuardVaultTestShim {
    enum SubsidyMode { NONE, REQUIRED, BEST_EFFORT }
    enum Decision { ALLOW, ESCALATE, BLOCK }
    enum Reason {
        OK, INVALID_SIGNATURE, INACTIVE_POLICY, EXPIRED, AGENT_REVOKED,
        MERCHANT_NOT_ALLOWED, CATEGORY_MISMATCH, TOKEN_MISMATCH,
        ROUTE_MISMATCH, INVOICE_ALREADY_PAID, NONCE_ALREADY_USED,
        TOTAL_OUTPUT_BUDGET, EPOCH_OUTPUT_BUDGET, INPUT_BUDGET,
        MAX_INPUT_LIMIT, ABOVE_ESCALATION_CEILING, APPROVAL_REQUIRED,
        INVALID_APPROVAL, EXECUTION_PAUSED, INSUFFICIENT_BALANCE,
        SUBSIDY_UNAVAILABLE, INVALID_AMOUNT
    }
    struct PolicyConfig {
        address agent;
        address inputToken;
        address settlementToken;
        address adapter;
        bytes32 routeId;
        uint256 totalOutputBudget;
        uint256 epochOutputBudget;
        uint256 automaticOutputCap;
        uint256 escalationOutputCap;
        uint256 totalInputBudget;
        uint256 maxInputPerPayment;
        uint48 validAfter;
        uint48 validUntil;
        uint256 allowedCategoryBitmap;
        SubsidyMode subsidyMode;
    }
    struct MerchantPermission {
        bytes32 merchantId;
        address recipient;
        address invoiceSigner;
        uint32 category;
    }
    struct Invoice {
        bytes32 invoiceId;
        bytes32 merchantId;
        address recipient;
        address settlementToken;
        uint256 outputAmount;
        uint32 category;
        uint48 validUntil;
    }
    struct PaymentIntent {
        bytes32 policyId;
        bytes32 invoiceHash;
        bytes32 routeId;
        uint256 maxInputAmount;
        uint256 nonce;
        uint48 validUntil;
        SubsidyMode subsidyMode;
        uint256 maxSubsidyAmount;
    }
    struct ExceptionApproval {
        bytes32 intentHash;
        uint256 nonce;
        uint48 validUntil;
    }
    struct Evaluation {
        Decision decision;
        Reason reason;
        uint256 remainingOutput;
        uint256 remainingEpochOutput;
        uint256 remainingInput;
        bool signaturesChecked;
    }
    struct PolicyState {
        bool active;
        bool revoked;
        bool agentRevoked;
        bool executionPaused;
        uint256 epoch;
        uint256 outputSpent;
        uint256 epochOutputSpent;
        uint256 inputSpent;
    }
    struct ExecutionContext {
        bool active;
        bytes32 intentHash;
        bytes32 policyId;
        bytes32 routeId;
        address adapter;
        address merchant;
        address inputToken;
        address outputToken;
        uint256 outputAmount;
        SubsidyMode subsidyMode;
        uint256 maxSubsidyAmount;
    }
    error Unauthorized();
    error PaymentRejected(Reason reason);
    error SettlementInvariant();
    event PaymentExecuted(
        bytes32 indexed intentHash, bytes32 indexed policyId, bytes32 indexed invoiceKey,
        address merchant, address inputToken, uint256 actualInput,
        address outputToken, uint256 exactOutput, bytes32 routeId,
        uint256 subsidyAmount
    );
    function deposit(address token, uint256 amount) external;
    function createPolicy(PolicyConfig calldata config, MerchantPermission[] calldata merchants)
        external returns (bytes32 policyId);
    function hashInvoice(Invoice calldata invoice) external view returns (bytes32);
    function hashIntent(PaymentIntent calldata intent) external view returns (bytes32);
    function hashApproval(ExceptionApproval calldata approval) external view returns (bytes32);
    function evaluate(
        Invoice calldata invoice, PaymentIntent calldata intent,
        bytes calldata agentSignature, bytes calldata merchantSignature,
        ExceptionApproval calldata approval, bytes calldata ownerSignature
    ) external view returns (Evaluation memory);
    function executePayment(
        Invoice calldata invoice, PaymentIntent calldata intent,
        bytes calldata agentSignature, bytes calldata merchantSignature,
        ExceptionApproval calldata approval, bytes calldata ownerSignature
    ) external returns (bytes32 intentHash, uint256 actualInput, uint256 subsidyAmount);
    function getPolicyState(bytes32 policyId) external view returns (PolicyState memory);
    function getExecutionContext() external view returns (ExecutionContext memory);
}
