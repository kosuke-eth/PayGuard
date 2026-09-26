// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * Stage 1 independent EIP-712 hashing harness. Hand-rolled directly from EIP-712's own spec
 * (https://eips.ethereum.org/EIPS/eip-712) — deliberately NOT importing OpenZeppelin's EIP712
 * base contract or any code from packages/domain, so this is a genuinely independent
 * reimplementation to cross-check against packages/domain/src/eip712.ts (viem's hashTypedData).
 * Struct field order/widths match reference/CONTRACT_INTERFACE.sol exactly (SPEC-003).
 */
contract Eip712HashHarness {
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 internal constant INVOICE_TYPEHASH = keccak256(
        "Invoice(bytes32 invoiceId,bytes32 merchantId,address recipient,address settlementToken,uint256 outputAmount,uint32 category,uint48 validUntil)"
    );

    bytes32 internal constant PAYMENT_INTENT_TYPEHASH = keccak256(
        "PaymentIntent(bytes32 policyId,bytes32 invoiceHash,bytes32 routeId,uint256 maxInputAmount,uint256 nonce,uint48 validUntil,uint8 subsidyMode,uint256 maxSubsidyAmount)"
    );

    bytes32 internal constant EXCEPTION_APPROVAL_TYPEHASH =
        keccak256("ExceptionApproval(bytes32 intentHash,uint256 nonce,uint48 validUntil)");

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
        uint8 subsidyMode;
        uint256 maxSubsidyAmount;
    }

    struct ExceptionApproval {
        bytes32 intentHash;
        uint256 nonce;
        uint48 validUntil;
    }

    function domainSeparator(uint256 chainId, address verifyingContract) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("PayGuard")),
                keccak256(bytes("1")),
                chainId,
                verifyingContract
            )
        );
    }

    function _digest(uint256 chainId, address verifyingContract, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(chainId, verifyingContract), structHash));
    }

    function hashInvoiceStruct(Invoice calldata invoice) public pure returns (bytes32) {
        return keccak256(
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
    }

    function hashInvoice(uint256 chainId, address verifyingContract, Invoice calldata invoice)
        external
        pure
        returns (bytes32)
    {
        return _digest(chainId, verifyingContract, hashInvoiceStruct(invoice));
    }

    function hashIntentStruct(PaymentIntent calldata intent) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PAYMENT_INTENT_TYPEHASH,
                intent.policyId,
                intent.invoiceHash,
                intent.routeId,
                intent.maxInputAmount,
                intent.nonce,
                intent.validUntil,
                intent.subsidyMode,
                intent.maxSubsidyAmount
            )
        );
    }

    function hashIntent(uint256 chainId, address verifyingContract, PaymentIntent calldata intent)
        external
        pure
        returns (bytes32)
    {
        return _digest(chainId, verifyingContract, hashIntentStruct(intent));
    }

    function hashApprovalStruct(ExceptionApproval calldata approval) public pure returns (bytes32) {
        return keccak256(
            abi.encode(EXCEPTION_APPROVAL_TYPEHASH, approval.intentHash, approval.nonce, approval.validUntil)
        );
    }

    function hashApproval(uint256 chainId, address verifyingContract, ExceptionApproval calldata approval)
        external
        pure
        returns (bytes32)
    {
        return _digest(chainId, verifyingContract, hashApprovalStruct(approval));
    }
}
