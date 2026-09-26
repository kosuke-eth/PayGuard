/**
 * Canonical business models. Field names/order/widths match API_CONTRACT.md "Canonical business
 * models" and reference/CONTRACT_INTERFACE.sol structs field-for-field (verified at Stage 1,
 * see docs/implementation/SOURCE_MAP.md). Wire representation: UIntString for every integer
 * width (uint256/uint48/uint32), hex strings for address/bytes32/bytes.
 */

import type { SubsidyModeWire } from './enums.js';
import type { Address, Hash32, HexBytes, ISODate, UIntString } from './primitives.js';

export interface PolicyConfig {
  agent: Address;
  inputToken: Address;
  settlementToken: Address;
  adapter: Address;
  routeId: Hash32;
  totalOutputBudget: UIntString;
  epochOutputBudget: UIntString;
  automaticOutputCap: UIntString;
  escalationOutputCap: UIntString;
  totalInputBudget: UIntString;
  maxInputPerPayment: UIntString;
  validAfter: UIntString;
  validUntil: UIntString;
  allowedCategoryBitmap: UIntString;
  subsidyMode: SubsidyModeWire;
}

export interface MerchantPermission {
  merchantId: Hash32;
  recipient: Address;
  invoiceSigner: Address;
  category: UIntString;
}

export interface Invoice {
  invoiceId: Hash32;
  merchantId: Hash32;
  recipient: Address;
  settlementToken: Address;
  outputAmount: UIntString;
  category: UIntString;
  validUntil: UIntString;
}

export interface PaymentIntent {
  policyId: Hash32;
  invoiceHash: Hash32;
  routeId: Hash32;
  maxInputAmount: UIntString;
  nonce: UIntString;
  validUntil: UIntString;
  subsidyMode: SubsidyModeWire;
  maxSubsidyAmount: UIntString;
}

export interface ExceptionApproval {
  intentHash: Hash32;
  nonce: UIntString;
  validUntil: UIntString;
}

const ZERO_HASH32: Hash32 = `0x${'0'.repeat(64)}`;

/** SPEC-002: the canonical zero-valued approval + empty signature, meaning "no exception". */
export const ZERO_APPROVAL: ExceptionApproval = {
  intentHash: ZERO_HASH32,
  nonce: '0',
  validUntil: '0',
};
export const ZERO_APPROVAL_SIGNATURE: HexBytes = '0x';

export interface Evaluation {
  decision: 'ALLOW' | 'ESCALATE' | 'BLOCK' | 'UNKNOWN';
  reasonCode: string;
  signaturesChecked: boolean;
  remainingOutputAtomic: UIntString | null;
  remainingEpochOutputAtomic: UIntString | null;
  remainingInputAtomic: UIntString | null;
  simulatedAt: Observation | null;
}

export interface Observation {
  blockNumber: UIntString;
  blockHash: Hash32;
  canonical: boolean;
  observedAt: ISODate;
}

export interface UnsignedTransaction {
  chainId: UIntString;
  from: Address;
  to: Address;
  data: HexBytes;
  value: UIntString;
  calldataHash: Hash32;
  abiSchemaVersion: '1';
}

export interface Operation {
  operationId: string;
  resourceType: string;
  resourceId: string;
  status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'UNKNOWN' | 'FAILED';
}

export interface PaymentView {
  paymentId: string;
  intentId: string | null;
  deploymentId: string;
  chainId: UIntString;
  invoice: {
    invoiceId: Hash32;
    recipient: Address;
    outputToken: Address;
    outputAmountAtomic: UIntString;
  };
  authorized: {
    inputToken: Address;
    maxInputAtomic: UIntString;
    routeId: Hash32;
  };
  policyDecision: 'ALLOW' | 'ESCALATE' | 'BLOCK' | 'UNKNOWN';
  executionStatus:
    | 'DRAFT'
    | 'AWAITING_APPROVAL'
    | 'READY'
    | 'QUEUED'
    | 'SIGNED'
    | 'SUBMITTED'
    | 'UNKNOWN'
    | 'INCLUDED'
    | 'SUCCEEDED'
    | 'REVERTED'
    | 'CANCELLED'
    | 'REORGED';
  confidence: 'UNOBSERVED' | 'INCLUDED' | 'DEPTH_CONFIRMED' | 'RPC_FINALIZED' | 'LOCAL_DEMO';
  reconciliation: 'NOT_CHECKED' | 'MATCHED' | 'MISMATCH';
  reasonCode: string | null;
  settlement: {
    actualInputAtomic: UIntString;
    outputDeliveredAtomic: UIntString;
    subsidyAmountAtomic: UIntString;
  } | null;
  transaction: { hash: Hash32; replacementOf: Hash32 | null } | null;
  observedAt: Observation | null;
}
