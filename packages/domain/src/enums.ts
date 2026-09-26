/**
 * Explicit enum conversions between API wire strings and Solidity ABI integer widths.
 * Source: reference/CONTRACT_INTERFACE.sol (enum declaration order = uint8 value),
 * API_CONTRACT.md (wire string spelling + explicit uint8 conversion rule for SubsidyMode).
 *
 * CLAUDE.md invariant: on-chain ALLOW/ESCALATE/BLOCK is a distinct axis from backend UNKNOWN.
 * UNKNOWN never has an on-chain uint8 encoding — it is a backend-only wire value produced when
 * infrastructure is unavailable, never sent to or read from the contract's Decision enum.
 */

// --- SubsidyMode: uint8, present in both PolicyConfig and PaymentIntent ABI structs ---
export const SUBSIDY_MODE_WIRE = ['NONE', 'REQUIRED', 'BEST_EFFORT'] as const;
export type SubsidyModeWire = (typeof SUBSIDY_MODE_WIRE)[number];
export type SubsidyModeOnChain = 0 | 1 | 2;

const SUBSIDY_MODE_TO_ONCHAIN: Record<SubsidyModeWire, SubsidyModeOnChain> = {
  NONE: 0,
  REQUIRED: 1,
  BEST_EFFORT: 2,
};
const SUBSIDY_MODE_FROM_ONCHAIN: Record<SubsidyModeOnChain, SubsidyModeWire> = {
  0: 'NONE',
  1: 'REQUIRED',
  2: 'BEST_EFFORT',
};

export function subsidyModeToOnChain(wire: SubsidyModeWire): SubsidyModeOnChain {
  return SUBSIDY_MODE_TO_ONCHAIN[wire];
}
export function subsidyModeFromOnChain(onChain: SubsidyModeOnChain): SubsidyModeWire {
  return SUBSIDY_MODE_FROM_ONCHAIN[onChain];
}

// --- Decision: uint8 on-chain (Evaluation.decision); UNKNOWN is wire-only, no on-chain value ---
export const ONCHAIN_DECISION_WIRE = ['ALLOW', 'ESCALATE', 'BLOCK'] as const;
export type OnChainDecisionWire = (typeof ONCHAIN_DECISION_WIRE)[number];
export type OnChainDecisionValue = 0 | 1 | 2;
export type PolicyDecisionWire = OnChainDecisionWire | 'UNKNOWN';

const DECISION_TO_ONCHAIN: Record<OnChainDecisionWire, OnChainDecisionValue> = {
  ALLOW: 0,
  ESCALATE: 1,
  BLOCK: 2,
};
const DECISION_FROM_ONCHAIN: Record<OnChainDecisionValue, OnChainDecisionWire> = {
  0: 'ALLOW',
  1: 'ESCALATE',
  2: 'BLOCK',
};

export function decisionToOnChain(wire: OnChainDecisionWire): OnChainDecisionValue {
  return DECISION_TO_ONCHAIN[wire];
}
export function decisionFromOnChain(onChain: OnChainDecisionValue): OnChainDecisionWire {
  return DECISION_FROM_ONCHAIN[onChain];
}

// --- Reason: uint8 on-chain, exact declaration order from INTERFACE ---
export const REASON_WIRE = [
  'OK',
  'INVALID_SIGNATURE',
  'INACTIVE_POLICY',
  'EXPIRED',
  'AGENT_REVOKED',
  'MERCHANT_NOT_ALLOWED',
  'CATEGORY_MISMATCH',
  'TOKEN_MISMATCH',
  'ROUTE_MISMATCH',
  'INVOICE_ALREADY_PAID',
  'NONCE_ALREADY_USED',
  'TOTAL_OUTPUT_BUDGET',
  'EPOCH_OUTPUT_BUDGET',
  'INPUT_BUDGET',
  'MAX_INPUT_LIMIT',
  'ABOVE_ESCALATION_CEILING',
  'APPROVAL_REQUIRED',
  'INVALID_APPROVAL',
  'EXECUTION_PAUSED',
  'INSUFFICIENT_BALANCE',
  'SUBSIDY_UNAVAILABLE',
  'INVALID_AMOUNT',
] as const;
export type ReasonWire = (typeof REASON_WIRE)[number];

export function reasonToOnChain(wire: ReasonWire): number {
  const index = REASON_WIRE.indexOf(wire);
  if (index < 0) throw new RangeError(`unknown Reason: ${wire}`);
  return index;
}
export function reasonFromOnChain(onChain: number): ReasonWire {
  const wire = REASON_WIRE[onChain];
  if (wire === undefined) throw new RangeError(`unknown on-chain Reason index: ${onChain}`);
  return wire;
}

// --- Backend-only status axes (no on-chain representation; API_CONTRACT.md PaymentView) ---
export const EXECUTION_STATUS_WIRE = [
  'DRAFT',
  'AWAITING_APPROVAL',
  'READY',
  'QUEUED',
  'SIGNED',
  'SUBMITTED',
  'UNKNOWN',
  'INCLUDED',
  'SUCCEEDED',
  'REVERTED',
  'CANCELLED',
  'REORGED',
] as const;
export type ExecutionStatusWire = (typeof EXECUTION_STATUS_WIRE)[number];

export const CONFIDENCE_WIRE = [
  'UNOBSERVED',
  'INCLUDED',
  'DEPTH_CONFIRMED',
  'RPC_FINALIZED',
  'LOCAL_DEMO',
] as const;
export type ConfidenceWire = (typeof CONFIDENCE_WIRE)[number];

export const RECONCILIATION_WIRE = ['NOT_CHECKED', 'MATCHED', 'MISMATCH'] as const;
export type ReconciliationWire = (typeof RECONCILIATION_WIRE)[number];

export const OPERATION_STATUS_WIRE = [
  'QUEUED',
  'IN_PROGRESS',
  'COMPLETED',
  'UNKNOWN',
  'FAILED',
] as const;
export type OperationStatusWire = (typeof OPERATION_STATUS_WIRE)[number];

// --- Category: uint32 on-chain, but bound to < 256 at the wire boundary (API_CONTRACT.md) ---
export const CATEGORY_WIRE_MAX = 255;

export function categoryToOnChain(wireDecimalString: string): number {
  const value = Number.parseInt(wireDecimalString, 10);
  if (!Number.isInteger(value) || value < 0 || value > CATEGORY_WIRE_MAX) {
    throw new RangeError(`category out of [0,255] wire bound: ${wireDecimalString}`);
  }
  return value;
}
