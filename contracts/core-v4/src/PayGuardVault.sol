// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * PayGuardVault: one non-upgradeable vault per immutable owner. Bounded-policy authorization
 * kernel + direct-transfer settlement + a typed external-adapter boundary for future conversion
 * routes (Stage 6). Stage 2 scope per PAYGUARD_BUILD_PROMPTS.md: the authorization core and the
 * direct-transfer path; the adapter boundary is built and tested against clearly-identified
 * test-only adapters (test/fixtures/*), not a real protocol integration.
 *
 * Design sources: reference/CONTRACT_INTERFACE.sol (exact ABI), 03_REBUILT_ARCHITECTURE.md §3.3
 * (state model, function-level design, atomic execution algorithm, decision precedence),
 * docs/implementation/DECISIONS.md SPEC-001/SPEC-002 (policy supersession derivation, zero-
 * approval definition).
 *
 * Decision precedence (documented, stable — see _evaluate): invoiceHash binding -> agent
 * signature -> policy existence/active/revoked -> time bounds -> agent-revoked -> merchant
 * exists+recipient -> merchant signature -> category -> settlement token -> route -> amount
 * sanity -> invoice replay -> agent nonce replay -> hard output budgets (total, epoch) -> hard
 * input budget -> per-payment input ceiling -> escalation ceiling (hard) -> automatic-cap
 * approval -> execution pause -> subsidy mode (Stage 2: NONE only) -> route-specific structural
 * checks (direct: token equality, in-route max-input bound, vault balance).
 */

import {IPayGuardVault} from "./interfaces/IPayGuardVault.sol";
import {IPayGuardSettlementAdapter} from "./interfaces/IPayGuardSettlementAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PayGuardVault is IPayGuardVault, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Additional errors, beyond the interface's minimum surface (owner-input validation,
    // distinct from the Unauthorized()/PaymentRejected() caller/decision-path errors). ---
    error InvalidPolicyConfig();
    error InvalidMerchantConfig();
    error InvalidToken();
    error InvalidRecipient();
    error PolicyNotFound();

    bytes32 private constant INVOICE_TYPEHASH = keccak256(
        "Invoice(bytes32 invoiceId,bytes32 merchantId,address recipient,address settlementToken,uint256 outputAmount,uint32 category,uint48 validUntil)"
    );
    bytes32 private constant PAYMENT_INTENT_TYPEHASH = keccak256(
        "PaymentIntent(bytes32 policyId,bytes32 invoiceHash,bytes32 routeId,uint256 maxInputAmount,uint256 nonce,uint48 validUntil,uint8 subsidyMode,uint256 maxSubsidyAmount)"
    );
    bytes32 private constant EXCEPTION_APPROVAL_TYPEHASH =
        keccak256("ExceptionApproval(bytes32 intentHash,uint256 nonce,uint48 validUntil)");

    /// The direct-transfer reference route's fixed identifier (paired with adapter == address(0)).
    bytes32 public constant DIRECT_ROUTE_ID = bytes32(0);
    uint256 private constant MAX_MERCHANTS_PER_POLICY = 32;
    uint256 private constant EPOCH_LENGTH = 1 days;
    uint256 private constant MAX_CATEGORY = 255;

    address public immutable owner;

    uint256 private policySequence;
    mapping(bytes32 => PolicyConfig) private policies;
    mapping(bytes32 => bool) private policyExists;
    mapping(bytes32 => bool) private policyRevoked;
    mapping(address => bytes32) private activePolicyForAgent;
    mapping(bytes32 => mapping(bytes32 => MerchantPermission)) private merchantPermissions;
    mapping(bytes32 => mapping(bytes32 => bool)) private merchantExists;
    mapping(bytes32 => uint256) private outputSpent;
    mapping(bytes32 => mapping(uint256 => uint256)) private epochOutputSpent;
    mapping(bytes32 => uint256) private inputSpent;
    mapping(bytes32 => bool) private consumedInvoice;
    mapping(address => mapping(uint256 => bool)) private usedAgentNonce;
    mapping(uint256 => bool) private usedOrCancelledApprovalNonce;
    mapping(address => bool) private revokedAgentMap;
    bool private executionPausedFlag;
    ExecutionContext private activeExecutionContext_;
    mapping(address => bool) private supportedTokenMap;

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    /// @param _owner The immutable vault owner. @param initialSupportedTokens The fixed token
    /// allowlist — immutable for this deployment; a changed allowlist requires a new vault
    /// deployment (ARCH: "use new local vault deployments when an immutable configuration
    /// changes").
    constructor(address _owner, address[] memory initialSupportedTokens) EIP712("PayGuard", "1") {
        if (_owner == address(0)) revert Unauthorized();
        owner = _owner;
        for (uint256 i = 0; i < initialSupportedTokens.length; i++) {
            supportedTokenMap[initialSupportedTokens[i]] = true;
        }
    }

    // ============================================================
    // Owner funding controls
    // ============================================================

    function deposit(address token, uint256 amount) external nonReentrant {
        if (!supportedTokenMap[token]) revert InvalidToken();
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        emit Deposited(msg.sender, token, received);
    }

    /// Execution pause never blocks withdrawal (CLAUDE.md invariant).
    function withdraw(address token, uint256 amount, address recipient) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert InvalidRecipient();
        IERC20(token).safeTransfer(recipient, amount);
        emit Withdrawn(recipient, token, amount);
    }

    // ============================================================
    // Policy administration (owner only)
    // ============================================================

    function createPolicy(PolicyConfig calldata config, MerchantPermission[] calldata merchants)
        external
        onlyOwner
        returns (bytes32 policyId)
    {
        _validatePolicyConfig(config);
        _validateMerchants(merchants, config.allowedCategoryBitmap);

        // Root-independent sequence + vault/chain domain; never recomputed from mutable
        // configuration (ARCH 3.3 "Policy and signed types"; SPEC-001).
        policyId = keccak256(abi.encode(address(this), block.chainid, policySequence));
        policySequence++;

        policies[policyId] = config;
        policyExists[policyId] = true;
        // SPEC-001: creating a new policy for an agent that already has one overwrites this
        // single slot. The prior policy's "active" state is derived (see getPolicyState), not
        // separately flagged here — no revokePolicy call is made on it.
        activePolicyForAgent[config.agent] = policyId;

        for (uint256 i = 0; i < merchants.length; i++) {
            merchantPermissions[policyId][merchants[i].merchantId] = merchants[i];
            merchantExists[policyId][merchants[i].merchantId] = true;
        }

        emit PolicyCreated(policyId, config.agent, keccak256(abi.encode(config)));
    }

    function revokePolicy(bytes32 policyId) external onlyOwner {
        if (!policyExists[policyId]) revert PolicyNotFound();
        policyRevoked[policyId] = true;
        emit PolicyRevoked(policyId);
    }

    /// Terminal in P0: revoked agents cannot regain authority; use a new agent address to
    /// replace them (ARCH 3.3 function-level design table).
    function revokeAgent(address agent) external onlyOwner {
        revokedAgentMap[agent] = true;
        emit AgentRevoked(agent);
    }

    /// Affects payment execution only — never withdrawal, revocation, or approval cancellation.
    function setExecutionPaused(bool paused) external onlyOwner {
        executionPausedFlag = paused;
        emit ExecutionPaused(paused);
    }

    function cancelApprovalNonce(uint256 nonce) external onlyOwner {
        usedOrCancelledApprovalNonce[nonce] = true;
        emit ApprovalNonceCancelled(nonce);
    }

    // ============================================================
    // EIP-712 hash helpers (production implementation; cross-checked in Stage 2 tests against
    // the same docs/implementation/evidence/eip712-vectors.json fixture Stage 1 established)
    // ============================================================

    function hashInvoice(Invoice calldata invoice) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                INVOICE_TYPEHASH,
                invoice.invoiceId,
                invoice.merchantId,
                invoice.recipient,
                invoice.settlementToken,
                invoice.outputAmount,
                invoice.category,
                invoice.validUntil
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function hashIntent(PaymentIntent calldata intent) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_INTENT_TYPEHASH,
                intent.policyId,
                intent.invoiceHash,
                intent.routeId,
                intent.maxInputAmount,
                intent.nonce,
                intent.validUntil,
                uint8(intent.subsidyMode),
                intent.maxSubsidyAmount
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function hashApproval(ExceptionApproval calldata approval) public view returns (bytes32) {
        bytes32 structHash =
            keccak256(abi.encode(EXCEPTION_APPROVAL_TYPEHASH, approval.intentHash, approval.nonce, approval.validUntil));
        return _hashTypedDataV4(structHash);
    }

    // ============================================================
    // Evaluation (view) and execution (state-changing) — share one validation path
    // ============================================================

    function evaluate(
        Invoice calldata invoice,
        PaymentIntent calldata intent,
        bytes calldata agentSignature,
        bytes calldata merchantSignature,
        ExceptionApproval calldata approval,
        bytes calldata ownerSignature
    ) external view returns (Evaluation memory evaluation) {
        (evaluation,,,) = _evaluate(invoice, intent, agentSignature, merchantSignature, approval, ownerSignature);
    }

    function executePayment(
        Invoice calldata invoice,
        PaymentIntent calldata intent,
        bytes calldata agentSignature,
        bytes calldata merchantSignature,
        ExceptionApproval calldata approval,
        bytes calldata ownerSignature
    ) external nonReentrant returns (bytes32 intentHashOut, uint256 actualInput, uint256 subsidyAmountOut) {
        (Evaluation memory evaluation, PolicyConfig memory policy, MerchantPermission memory merchant, bytes32 intentHash)
        = _evaluate(invoice, intent, agentSignature, merchantSignature, approval, ownerSignature);

        if (evaluation.decision != Decision.ALLOW) {
            revert PaymentRejected(evaluation.reason);
        }

        // ---- Consume authority before any external interaction ----
        bytes32 invoiceKey = _invoiceKey(invoice.recipient, invoice.invoiceId);
        consumedInvoice[invoiceKey] = true;
        usedAgentNonce[policy.agent][intent.nonce] = true;

        bool neededApproval = invoice.outputAmount > policy.automaticOutputCap;
        if (neededApproval) {
            usedOrCancelledApprovalNonce[approval.nonce] = true;
        }

        uint256 epoch = block.timestamp / EPOCH_LENGTH;
        outputSpent[intent.policyId] += invoice.outputAmount;
        epochOutputSpent[intent.policyId][epoch] += invoice.outputAmount;
        // In-transaction reservation at the signed ceiling; refunded to actual usage below.
        // This is not a cross-transaction reservation — it exists only until this call returns.
        inputSpent[intent.policyId] += intent.maxInputAmount;

        activeExecutionContext_ = ExecutionContext({
            active: true,
            intentHash: intentHash,
            policyId: intent.policyId,
            routeId: intent.routeId,
            adapter: policy.adapter,
            merchant: merchant.recipient,
            inputToken: policy.inputToken,
            outputToken: policy.settlementToken,
            outputAmount: invoice.outputAmount,
            subsidyMode: intent.subsidyMode,
            maxSubsidyAmount: intent.maxSubsidyAmount
        });

        if (policy.adapter == address(0)) {
            actualInput = _settleDirect(policy, merchant, invoice.outputAmount);
        } else {
            actualInput = _settleViaAdapter(policy, merchant, intent, invoice.outputAmount);
        }
        // Stage 2: subsidy not implemented (Stage 6); _evaluate already forced subsidyMode NONE.
        subsidyAmountOut = 0;

        // Refund the unused portion of the reservation; finalize actual input usage.
        inputSpent[intent.policyId] = inputSpent[intent.policyId] - intent.maxInputAmount + actualInput;

        delete activeExecutionContext_;

        emit PaymentExecuted(
            intentHash,
            intent.policyId,
            invoiceKey,
            merchant.recipient,
            policy.inputToken,
            actualInput,
            policy.settlementToken,
            invoice.outputAmount,
            intent.routeId,
            subsidyAmountOut
        );

        return (intentHash, actualInput, subsidyAmountOut);
    }

    /// @dev Shared validation. Never moves tokens or writes state — evaluate() and
    /// executePayment() both call this; only executePayment acts on an ALLOW result.
    function _evaluate(
        Invoice calldata invoice,
        PaymentIntent calldata intent,
        bytes calldata agentSignature,
        bytes calldata merchantSignature,
        ExceptionApproval calldata approval,
        bytes calldata ownerSignature
    )
        internal
        view
        returns (Evaluation memory evaluation, PolicyConfig memory policy, MerchantPermission memory merchant, bytes32 intentHash)
    {
        evaluation.decision = Decision.BLOCK;

        bytes32 invoiceHash = hashInvoice(invoice);
        if (intent.invoiceHash != invoiceHash) {
            evaluation.reason = Reason.INVALID_SIGNATURE;
            return (evaluation, policy, merchant, intentHash);
        }
        intentHash = hashIntent(intent);

        if (!policyExists[intent.policyId]) {
            evaluation.reason = Reason.INACTIVE_POLICY;
            return (evaluation, policy, merchant, intentHash);
        }
        policy = policies[intent.policyId];

        if (!_verifyEOA(policy.agent, intentHash, agentSignature)) {
            evaluation.reason = Reason.INVALID_SIGNATURE;
            return (evaluation, policy, merchant, intentHash);
        }

        if (activePolicyForAgent[policy.agent] != intent.policyId || policyRevoked[intent.policyId]) {
            evaluation.reason = Reason.INACTIVE_POLICY;
            return (evaluation, policy, merchant, intentHash);
        }

        if (
            block.timestamp < policy.validAfter || block.timestamp > policy.validUntil
                || block.timestamp > invoice.validUntil || block.timestamp > intent.validUntil
        ) {
            evaluation.reason = Reason.EXPIRED;
            return (evaluation, policy, merchant, intentHash);
        }

        if (revokedAgentMap[policy.agent]) {
            evaluation.reason = Reason.AGENT_REVOKED;
            return (evaluation, policy, merchant, intentHash);
        }

        if (!merchantExists[intent.policyId][invoice.merchantId]) {
            evaluation.reason = Reason.MERCHANT_NOT_ALLOWED;
            return (evaluation, policy, merchant, intentHash);
        }
        merchant = merchantPermissions[intent.policyId][invoice.merchantId];
        if (merchant.recipient != invoice.recipient) {
            evaluation.reason = Reason.MERCHANT_NOT_ALLOWED;
            return (evaluation, policy, merchant, intentHash);
        }

        if (!_verifyEOA(merchant.invoiceSigner, invoiceHash, merchantSignature)) {
            evaluation.reason = Reason.INVALID_SIGNATURE;
            return (evaluation, policy, merchant, intentHash);
        }

        if (invoice.category != merchant.category || ((policy.allowedCategoryBitmap >> invoice.category) & 1) == 0) {
            evaluation.reason = Reason.CATEGORY_MISMATCH;
            return (evaluation, policy, merchant, intentHash);
        }

        if (invoice.settlementToken != policy.settlementToken) {
            evaluation.reason = Reason.TOKEN_MISMATCH;
            return (evaluation, policy, merchant, intentHash);
        }
        if (intent.routeId != policy.routeId) {
            evaluation.reason = Reason.ROUTE_MISMATCH;
            return (evaluation, policy, merchant, intentHash);
        }

        if (invoice.outputAmount == 0) {
            evaluation.reason = Reason.INVALID_AMOUNT;
            return (evaluation, policy, merchant, intentHash);
        }

        bytes32 invoiceKey = _invoiceKey(invoice.recipient, invoice.invoiceId);
        if (consumedInvoice[invoiceKey]) {
            evaluation.reason = Reason.INVOICE_ALREADY_PAID;
            return (evaluation, policy, merchant, intentHash);
        }
        if (usedAgentNonce[policy.agent][intent.nonce]) {
            evaluation.reason = Reason.NONCE_ALREADY_USED;
            return (evaluation, policy, merchant, intentHash);
        }

        uint256 epoch = block.timestamp / EPOCH_LENGTH;
        evaluation.remainingOutput =
            policy.totalOutputBudget > outputSpent[intent.policyId] ? policy.totalOutputBudget - outputSpent[intent.policyId] : 0;
        evaluation.remainingEpochOutput = policy.epochOutputBudget > epochOutputSpent[intent.policyId][epoch]
            ? policy.epochOutputBudget - epochOutputSpent[intent.policyId][epoch]
            : 0;
        evaluation.remainingInput =
            policy.totalInputBudget > inputSpent[intent.policyId] ? policy.totalInputBudget - inputSpent[intent.policyId] : 0;

        if (outputSpent[intent.policyId] + invoice.outputAmount > policy.totalOutputBudget) {
            evaluation.reason = Reason.TOTAL_OUTPUT_BUDGET;
            return (evaluation, policy, merchant, intentHash);
        }
        if (epochOutputSpent[intent.policyId][epoch] + invoice.outputAmount > policy.epochOutputBudget) {
            evaluation.reason = Reason.EPOCH_OUTPUT_BUDGET;
            return (evaluation, policy, merchant, intentHash);
        }
        if (inputSpent[intent.policyId] + intent.maxInputAmount > policy.totalInputBudget) {
            evaluation.reason = Reason.INPUT_BUDGET;
            return (evaluation, policy, merchant, intentHash);
        }
        if (intent.maxInputAmount > policy.maxInputPerPayment) {
            evaluation.reason = Reason.MAX_INPUT_LIMIT;
            return (evaluation, policy, merchant, intentHash);
        }

        // Escalation ceiling is a hard rule: no approval, however valid, can move it.
        if (invoice.outputAmount > policy.escalationOutputCap) {
            evaluation.reason = Reason.ABOVE_ESCALATION_CEILING;
            return (evaluation, policy, merchant, intentHash);
        }

        evaluation.signaturesChecked = true; // agent + merchant already verified above
        bool needsApproval = invoice.outputAmount > policy.automaticOutputCap;
        bool isZeroApproval = approval.intentHash == bytes32(0) && approval.nonce == 0 && approval.validUntil == 0
            && ownerSignature.length == 0;

        if (needsApproval) {
            if (isZeroApproval) {
                evaluation.reason = Reason.APPROVAL_REQUIRED;
                evaluation.decision = Decision.ESCALATE;
                return (evaluation, policy, merchant, intentHash);
            }
            if (!_validApproval(approval, ownerSignature, intentHash)) {
                evaluation.reason = Reason.INVALID_APPROVAL;
                return (evaluation, policy, merchant, intentHash);
            }
        } else if (!isZeroApproval) {
            // SPEC-002: a non-empty approval on a payment that does not need one is still
            // fully validated — malformed optional data must never silently expand authority.
            if (!_validApproval(approval, ownerSignature, intentHash)) {
                evaluation.reason = Reason.INVALID_APPROVAL;
                return (evaluation, policy, merchant, intentHash);
            }
        }

        if (executionPausedFlag) {
            evaluation.reason = Reason.EXECUTION_PAUSED;
            return (evaluation, policy, merchant, intentHash);
        }

        if (intent.subsidyMode != SubsidyMode.NONE) {
            // Stage 2 scope: subsidy composition is Stage 6. Any non-NONE intent is rejected
            // gracefully here rather than reverting, since it is caller-supplied per-payment data.
            evaluation.reason = Reason.SUBSIDY_UNAVAILABLE;
            return (evaluation, policy, merchant, intentHash);
        }

        if (policy.adapter == address(0)) {
            if (policy.inputToken != policy.settlementToken || policy.routeId != DIRECT_ROUTE_ID) {
                evaluation.reason = Reason.ROUTE_MISMATCH;
                return (evaluation, policy, merchant, intentHash);
            }
            if (invoice.outputAmount > intent.maxInputAmount) {
                evaluation.reason = Reason.MAX_INPUT_LIMIT;
                return (evaluation, policy, merchant, intentHash);
            }
            if (IERC20(policy.settlementToken).balanceOf(address(this)) < invoice.outputAmount) {
                evaluation.reason = Reason.INSUFFICIENT_BALANCE;
                return (evaluation, policy, merchant, intentHash);
            }
        }

        evaluation.decision = Decision.ALLOW;
        evaluation.reason = Reason.OK;
        return (evaluation, policy, merchant, intentHash);
    }

    function _validApproval(ExceptionApproval calldata approval, bytes calldata ownerSignature, bytes32 intentHash)
        private
        view
        returns (bool)
    {
        if (approval.intentHash != intentHash) return false;
        if (approval.validUntil < block.timestamp) return false;
        if (usedOrCancelledApprovalNonce[approval.nonce]) return false;
        bytes32 approvalDigest = hashApproval(approval);
        return SignatureChecker.isValidSignatureNow(owner, approvalDigest, ownerSignature);
    }

    /// P0: agent/merchant signers are EOA-only (ARCH 3.3 atomic execution algorithm step 1).
    /// Uses tryRecover so a malformed signature yields a clean `false`, never a revert — a
    /// distinguishable INVALID_SIGNATURE result, not an unrelated panic.
    function _verifyEOA(address expectedSigner, bytes32 digest, bytes calldata signature) private pure returns (bool) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError) return false;
        return recovered != address(0) && recovered == expectedSigner;
    }

    function _invoiceKey(address recipient, bytes32 invoiceId) private pure returns (bytes32) {
        return keccak256(abi.encode(recipient, invoiceId));
    }

    // ============================================================
    // Settlement (called only from executePayment, after consumption/reservation)
    // ============================================================

    function _settleDirect(PolicyConfig memory policy, MerchantPermission memory merchant, uint256 outputAmount)
        private
        returns (uint256 actualInput)
    {
        // Forbid aliased recipients that would invalidate the accounting assumptions.
        if (merchant.recipient == address(this) || merchant.recipient == policy.adapter) {
            revert SettlementInvariant();
        }

        uint256 balanceBefore = IERC20(policy.settlementToken).balanceOf(merchant.recipient);
        IERC20(policy.settlementToken).safeTransfer(merchant.recipient, outputAmount);
        uint256 delivered = IERC20(policy.settlementToken).balanceOf(merchant.recipient) - balanceBefore;
        if (delivered != outputAmount) revert SettlementInvariant();

        // Direct route: input token == settlement token, so actual input == exact output.
        actualInput = outputAmount;
    }

    function _settleViaAdapter(
        PolicyConfig memory policy,
        MerchantPermission memory merchant,
        PaymentIntent calldata intent,
        uint256 outputAmount
    ) private returns (uint256 actualInput) {
        if (merchant.recipient == address(this) || merchant.recipient == policy.adapter) {
            revert SettlementInvariant();
        }

        IERC20 inputToken = IERC20(policy.inputToken);
        IERC20 outputToken = IERC20(policy.settlementToken);

        uint256 vaultInputBefore = inputToken.balanceOf(address(this));
        uint256 vaultOutputBefore = outputToken.balanceOf(address(this));

        inputToken.forceApprove(policy.adapter, intent.maxInputAmount);

        IPayGuardSettlementAdapter.SettlementRequest memory request = IPayGuardSettlementAdapter.SettlementRequest({
            intentHash: activeExecutionContext_.intentHash,
            routeId: intent.routeId,
            inputToken: policy.inputToken,
            outputToken: policy.settlementToken,
            merchant: merchant.recipient,
            exactOutput: outputAmount,
            maxInput: intent.maxInputAmount,
            validUntil: intent.validUntil,
            subsidyMode: intent.subsidyMode,
            maxSubsidyAmount: intent.maxSubsidyAmount
        });

        IPayGuardSettlementAdapter(policy.adapter).settle(request);

        // Clear any residual allowance regardless of what the adapter actually pulled.
        inputToken.forceApprove(policy.adapter, 0);

        uint256 vaultInputAfter = inputToken.balanceOf(address(this));
        uint256 vaultOutputAfter = outputToken.balanceOf(address(this));

        if (vaultInputAfter > vaultInputBefore) revert SettlementInvariant();
        actualInput = vaultInputBefore - vaultInputAfter;
        if (actualInput > intent.maxInputAmount) revert SettlementInvariant();

        if (vaultOutputAfter < vaultOutputBefore) revert SettlementInvariant();
        uint256 outputReceived = vaultOutputAfter - vaultOutputBefore;
        if (outputReceived != outputAmount) revert SettlementInvariant();

        uint256 merchantBefore = outputToken.balanceOf(merchant.recipient);
        outputToken.safeTransfer(merchant.recipient, outputAmount);
        uint256 delivered = outputToken.balanceOf(merchant.recipient) - merchantBefore;
        if (delivered != outputAmount) revert SettlementInvariant();
    }

    // ============================================================
    // Config validation (owner input; distinct from the evaluate/execute Reason-coded path)
    // ============================================================

    function _validatePolicyConfig(PolicyConfig calldata config) private view {
        if (config.agent == address(0)) revert InvalidPolicyConfig();
        if (!supportedTokenMap[config.inputToken] || !supportedTokenMap[config.settlementToken]) {
            revert InvalidToken();
        }
        if (config.validAfter >= config.validUntil) revert InvalidPolicyConfig();
        if (config.automaticOutputCap > config.escalationOutputCap) revert InvalidPolicyConfig();
        if (config.escalationOutputCap > config.totalOutputBudget) revert InvalidPolicyConfig();
        if (config.epochOutputBudget > config.totalOutputBudget) revert InvalidPolicyConfig();
        if (config.maxInputPerPayment > config.totalInputBudget) revert InvalidPolicyConfig();
        // Stage 2 scope: subsidy composition is Stage 6; no policy may claim it yet.
        if (config.subsidyMode != SubsidyMode.NONE) revert InvalidPolicyConfig();

        if (config.inputToken == config.settlementToken) {
            if (config.adapter != address(0) || config.routeId != DIRECT_ROUTE_ID) revert InvalidPolicyConfig();
        } else {
            if (config.adapter == address(0) || config.routeId == DIRECT_ROUTE_ID) revert InvalidPolicyConfig();
        }
    }

    function _validateMerchants(MerchantPermission[] calldata merchants, uint256 allowedCategoryBitmap) private pure {
        uint256 n = merchants.length;
        if (n == 0 || n > MAX_MERCHANTS_PER_POLICY) revert InvalidMerchantConfig();
        for (uint256 i = 0; i < n; i++) {
            MerchantPermission calldata m = merchants[i];
            if (m.merchantId == bytes32(0)) revert InvalidMerchantConfig();
            if (m.recipient == address(0) || m.invoiceSigner == address(0)) revert InvalidMerchantConfig();
            if (m.category > MAX_CATEGORY) revert InvalidMerchantConfig();
            if (((allowedCategoryBitmap >> m.category) & 1) == 0) revert InvalidMerchantConfig();
            for (uint256 j = i + 1; j < n; j++) {
                if (merchants[i].merchantId == merchants[j].merchantId) revert InvalidMerchantConfig();
            }
        }
    }

    // ============================================================
    // Reads
    // ============================================================

    function isSupportedToken(address token) external view returns (bool) {
        return supportedTokenMap[token];
    }

    function getPolicyState(bytes32 policyId) external view returns (PolicyState memory state) {
        PolicyConfig memory policy = policies[policyId];
        bool exists = policyExists[policyId];
        state.revoked = policyRevoked[policyId];
        state.agentRevoked = exists && revokedAgentMap[policy.agent];
        state.active = exists && !state.revoked && activePolicyForAgent[policy.agent] == policyId;
        state.executionPaused = executionPausedFlag;
        state.epoch = block.timestamp / EPOCH_LENGTH;
        state.outputSpent = outputSpent[policyId];
        state.epochOutputSpent = epochOutputSpent[policyId][state.epoch];
        state.inputSpent = inputSpent[policyId];
    }

    function isInvoiceConsumed(address recipient, bytes32 invoiceId) external view returns (bool) {
        return consumedInvoice[_invoiceKey(recipient, invoiceId)];
    }

    function isAgentNonceUsed(address agent, uint256 nonce) external view returns (bool) {
        return usedAgentNonce[agent][nonce];
    }

    function isApprovalNonceUsedOrCancelled(uint256 nonce) external view returns (bool) {
        return usedOrCancelledApprovalNonce[nonce];
    }

    function getPolicy(bytes32 policyId) external view returns (PolicyConfig memory) {
        return policies[policyId];
    }

    function getMerchantPermission(bytes32 policyId, bytes32 merchantId) external view returns (MerchantPermission memory) {
        return merchantPermissions[policyId][merchantId];
    }

    function getExecutionContext() external view returns (ExecutionContext memory) {
        return activeExecutionContext_;
    }
}
