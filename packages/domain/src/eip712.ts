/**
 * PayGuard EIP-712 domain, type descriptors and TypeScript-side digest encoder.
 *
 * Source: reference/CONTRACT_INTERFACE.sol (struct field order/widths),
 * API_CONTRACT.md "One EIP-712 domain: name 'PayGuard', version '1', correct chainId,
 * verifyingContract equal to the actual vault. Distinct primary types are Invoice,
 * PaymentIntent and ExceptionApproval." SPEC-003 confirms this field order was resolved
 * by direct inspection, no correction needed.
 *
 * This is one half of the Stage 1 "independent cross-language vector" requirement. The other
 * half is contracts/core-v4/test/Eip712Vectors.t.sol, a hand-written Solidity hashing harness
 * that does NOT import this file or any shared code — it reimplements the same EIP-712 rules
 * independently so a bug in this encoder cannot also be present in the check that verifies it.
 *
 * Note on JS types: viem infers uint256 fields as `bigint` and narrower fields (uint8/uint32/
 * uint48) as `number` — uint48's max (2^48-1) is well within Number.MAX_SAFE_INTEGER, so
 * Number.parseInt is exact here even though the wire type is a decimal string.
 */
import { hashTypedData } from 'viem';
import { type SubsidyModeWire, subsidyModeToOnChain } from './enums.js';
import type { Address, Hash32, UIntString } from './primitives.js';
import type { ExceptionApproval, Invoice, PaymentIntent } from './types.js';

export interface PayGuardDomain {
  chainId: number;
  verifyingContract: Address;
}

export function domainFor(d: PayGuardDomain) {
  return {
    name: 'PayGuard',
    version: '1',
    chainId: d.chainId,
    verifyingContract: d.verifyingContract,
  } as const;
}

export const EIP712_TYPES = {
  Invoice: [
    { name: 'invoiceId', type: 'bytes32' },
    { name: 'merchantId', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'settlementToken', type: 'address' },
    { name: 'outputAmount', type: 'uint256' },
    { name: 'category', type: 'uint32' },
    { name: 'validUntil', type: 'uint48' },
  ],
  PaymentIntent: [
    { name: 'policyId', type: 'bytes32' },
    { name: 'invoiceHash', type: 'bytes32' },
    { name: 'routeId', type: 'bytes32' },
    { name: 'maxInputAmount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'validUntil', type: 'uint48' },
    { name: 'subsidyMode', type: 'uint8' },
    { name: 'maxSubsidyAmount', type: 'uint256' },
  ],
  ExceptionApproval: [
    { name: 'intentHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'validUntil', type: 'uint48' },
  ],
} as const;

export function hashInvoice(domain: PayGuardDomain, invoice: Invoice): Hash32 {
  return hashTypedData({
    domain: domainFor(domain),
    types: EIP712_TYPES,
    primaryType: 'Invoice',
    message: {
      invoiceId: invoice.invoiceId,
      merchantId: invoice.merchantId,
      recipient: invoice.recipient,
      settlementToken: invoice.settlementToken,
      outputAmount: BigInt(invoice.outputAmount),
      category: Number.parseInt(invoice.category, 10),
      validUntil: Number.parseInt(invoice.validUntil, 10),
    },
  }) as Hash32;
}

export function hashIntent(domain: PayGuardDomain, intent: PaymentIntent): Hash32 {
  return hashTypedData({
    domain: domainFor(domain),
    types: EIP712_TYPES,
    primaryType: 'PaymentIntent',
    message: {
      policyId: intent.policyId,
      invoiceHash: intent.invoiceHash,
      routeId: intent.routeId,
      maxInputAmount: BigInt(intent.maxInputAmount),
      nonce: BigInt(intent.nonce),
      validUntil: Number.parseInt(intent.validUntil, 10),
      subsidyMode: subsidyModeToOnChain(intent.subsidyMode as SubsidyModeWire),
      maxSubsidyAmount: BigInt(intent.maxSubsidyAmount),
    },
  }) as Hash32;
}

export function hashApproval(domain: PayGuardDomain, approval: ExceptionApproval): Hash32 {
  return hashTypedData({
    domain: domainFor(domain),
    types: EIP712_TYPES,
    primaryType: 'ExceptionApproval',
    message: {
      intentHash: approval.intentHash,
      nonce: BigInt(approval.nonce),
      validUntil: Number.parseInt(approval.validUntil, 10),
    },
  }) as Hash32;
}

/** Approval nonce is deterministically uint256(intentHash) per API_CONTRACT.md (P0 rule). */
export function approvalNonceFromIntentHash(intentHash: Hash32): UIntString {
  return BigInt(intentHash).toString(10);
}
