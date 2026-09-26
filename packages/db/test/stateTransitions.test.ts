import { describe, expect, it } from 'vitest';
import {
  isConfidenceTransitionAllowed,
  isExecutionStatusTransitionAllowed,
  isOperationStatusTransitionAllowed,
  isPolicyDecisionTransitionAllowed,
  isReconciliationTransitionAllowed,
  isTransactionAttemptStateTransitionAllowed,
} from '../src/stateTransitions.js';

describe('executionStatus transitions', () => {
  it('allows the happy path through to SUCCEEDED', () => {
    const path = [
      'DRAFT',
      'READY',
      'QUEUED',
      'SIGNED',
      'SUBMITTED',
      'INCLUDED',
      'SUCCEEDED',
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(isExecutionStatusTransitionAllowed(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('rejects skipping SIGNED/SUBMITTED straight to INCLUDED', () => {
    expect(isExecutionStatusTransitionAllowed('QUEUED', 'INCLUDED')).toBe(false);
  });

  it('a known revert allows a fresh attempt (invoice not permanently blocked)', () => {
    expect(isExecutionStatusTransitionAllowed('REVERTED', 'READY')).toBe(true);
  });

  it('an unknown broadcast can resolve forward to INCLUDED or REVERTED, or reconcile back to SUBMITTED', () => {
    expect(isExecutionStatusTransitionAllowed('UNKNOWN', 'INCLUDED')).toBe(true);
    expect(isExecutionStatusTransitionAllowed('UNKNOWN', 'REVERTED')).toBe(true);
    expect(isExecutionStatusTransitionAllowed('UNKNOWN', 'SUBMITTED')).toBe(true);
  });

  it('an orphaned (reorged) receipt regresses to UNKNOWN for re-observation, from any post-inclusion state', () => {
    expect(isExecutionStatusTransitionAllowed('INCLUDED', 'REORGED')).toBe(true);
    expect(isExecutionStatusTransitionAllowed('SUCCEEDED', 'REORGED')).toBe(true);
    expect(isExecutionStatusTransitionAllowed('REORGED', 'UNKNOWN')).toBe(true);
  });

  it('rejects a terminal SUCCEEDED silently reverting without going through REORGED', () => {
    expect(isExecutionStatusTransitionAllowed('SUCCEEDED', 'REVERTED')).toBe(false);
  });

  it('rejects a no-op transition to the same state', () => {
    expect(isExecutionStatusTransitionAllowed('SUBMITTED', 'SUBMITTED')).toBe(false);
  });

  it('SPEC-029: a receipt observed directly from SUBMITTED/UNKNOWN can settle without a forced INCLUDED step', () => {
    expect(isExecutionStatusTransitionAllowed('SUBMITTED', 'SUCCEEDED')).toBe(true);
    expect(isExecutionStatusTransitionAllowed('SUBMITTED', 'REVERTED')).toBe(true);
    expect(isExecutionStatusTransitionAllowed('UNKNOWN', 'SUCCEEDED')).toBe(true);
  });
});

describe('confidence transitions', () => {
  it('climbs the ladder toward RPC_FINALIZED', () => {
    expect(isConfidenceTransitionAllowed('UNOBSERVED', 'INCLUDED')).toBe(true);
    expect(isConfidenceTransitionAllowed('INCLUDED', 'DEPTH_CONFIRMED')).toBe(true);
    expect(isConfidenceTransitionAllowed('DEPTH_CONFIRMED', 'RPC_FINALIZED')).toBe(true);
  });

  it('rejects skipping straight from UNOBSERVED to DEPTH_CONFIRMED', () => {
    expect(isConfidenceTransitionAllowed('UNOBSERVED', 'DEPTH_CONFIRMED')).toBe(false);
  });

  it('a reorg regresses any level back to UNOBSERVED', () => {
    expect(isConfidenceTransitionAllowed('RPC_FINALIZED', 'UNOBSERVED')).toBe(true);
    expect(isConfidenceTransitionAllowed('LOCAL_DEMO', 'UNOBSERVED')).toBe(true);
  });

  it('SPEC-029: LOCAL_DEMO is reachable directly from UNOBSERVED, not only via INCLUDED', () => {
    expect(isConfidenceTransitionAllowed('UNOBSERVED', 'LOCAL_DEMO')).toBe(true);
  });
});

describe('reconciliation transitions', () => {
  it('goes NOT_CHECKED -> MATCHED and NOT_CHECKED -> MISMATCH directly', () => {
    expect(isReconciliationTransitionAllowed('NOT_CHECKED', 'MATCHED')).toBe(true);
    expect(isReconciliationTransitionAllowed('NOT_CHECKED', 'MISMATCH')).toBe(true);
  });

  it('MISMATCH cannot flip directly to MATCHED -- must go through a fresh NOT_CHECKED cycle', () => {
    expect(isReconciliationTransitionAllowed('MISMATCH', 'MATCHED')).toBe(false);
    expect(isReconciliationTransitionAllowed('MISMATCH', 'NOT_CHECKED')).toBe(true);
  });
});

describe('policyDecision transitions', () => {
  it('a provider failure resolves from UNKNOWN into any concrete decision', () => {
    expect(isPolicyDecisionTransitionAllowed('UNKNOWN', 'ALLOW')).toBe(true);
    expect(isPolicyDecisionTransitionAllowed('UNKNOWN', 'BLOCK')).toBe(true);
  });

  it('a fresh intent version can re-evaluate to any other concrete decision', () => {
    expect(isPolicyDecisionTransitionAllowed('BLOCK', 'ALLOW')).toBe(true);
  });
});

describe('operationStatus transitions', () => {
  it('COMPLETED is terminal', () => {
    expect(isOperationStatusTransitionAllowed('COMPLETED', 'IN_PROGRESS')).toBe(false);
    expect(isOperationStatusTransitionAllowed('COMPLETED', 'FAILED')).toBe(false);
  });

  it('FAILED allows an explicit retry back to IN_PROGRESS', () => {
    expect(isOperationStatusTransitionAllowed('FAILED', 'IN_PROGRESS')).toBe(true);
  });

  it('UNKNOWN broadcast state resolves to IN_PROGRESS, COMPLETED, or FAILED', () => {
    expect(isOperationStatusTransitionAllowed('UNKNOWN', 'IN_PROGRESS')).toBe(true);
    expect(isOperationStatusTransitionAllowed('UNKNOWN', 'COMPLETED')).toBe(true);
    expect(isOperationStatusTransitionAllowed('UNKNOWN', 'FAILED')).toBe(true);
  });
});

describe('transaction_attempts.state transitions (SPEC-013, SPEC-029)', () => {
  it('SIGNED -> SUBMITTED -> receipt settles directly to SUCCEEDED or REVERTED', () => {
    expect(isTransactionAttemptStateTransitionAllowed('SIGNED', 'SUBMITTED')).toBe(true);
    expect(isTransactionAttemptStateTransitionAllowed('SUBMITTED', 'SUCCEEDED')).toBe(true);
    expect(isTransactionAttemptStateTransitionAllowed('SUBMITTED', 'REVERTED')).toBe(true);
  });

  it('UNKNOWN (RPC-timeout observation) also settles directly to SUCCEEDED or REVERTED', () => {
    expect(isTransactionAttemptStateTransitionAllowed('UNKNOWN', 'SUCCEEDED')).toBe(true);
    expect(isTransactionAttemptStateTransitionAllowed('UNKNOWN', 'REVERTED')).toBe(true);
  });

  it('a two-phase observation through INCLUDED first is still legal, not the only path', () => {
    expect(isTransactionAttemptStateTransitionAllowed('SUBMITTED', 'INCLUDED')).toBe(true);
    expect(isTransactionAttemptStateTransitionAllowed('INCLUDED', 'SUCCEEDED')).toBe(true);
  });

  it('REPLACED and CANCELLED are terminal -- no outgoing edges', () => {
    expect(isTransactionAttemptStateTransitionAllowed('REPLACED', 'SUCCEEDED')).toBe(false);
    expect(isTransactionAttemptStateTransitionAllowed('CANCELLED', 'SUBMITTED')).toBe(false);
  });

  it('a reorged terminal attempt regresses to UNKNOWN for re-observation', () => {
    expect(isTransactionAttemptStateTransitionAllowed('SUCCEEDED', 'REORGED')).toBe(true);
    expect(isTransactionAttemptStateTransitionAllowed('REORGED', 'UNKNOWN')).toBe(true);
  });
});
