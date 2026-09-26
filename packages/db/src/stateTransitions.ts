/**
 * Pure state-transition legality for PayGuard's four independent payment axes plus operation
 * status. No SQL here -- these are checked in application code before a repository function
 * issues its `UPDATE ... WHERE id = $1 AND state_version = $2` compare-and-set (the actual
 * concurrency-safety mechanism lives in that SQL WHERE clause, not in these functions; these
 * functions only decide whether a transition is semantically allowed at all).
 *
 * ARCH 3.4 "State model consumed by the frontend": policyDecision, executionStatus, confidence
 * and reconciliation are separate axes -- never conflate them into one enum, and never let a
 * controller/worker free-assign a status without checking here first (Prompt 3 item 4).
 */
import type {
  ConfidenceWire,
  ExecutionStatusWire,
  OperationStatusWire,
  PolicyDecisionWire,
  ReconciliationWire,
} from '@payguard/domain';

type Graph<S extends string> = Readonly<Record<S, readonly S[]>>;

function isAllowed<S extends string>(graph: Graph<S>, from: S, to: S): boolean {
  if (from === to) return false; // a transition to the same state is a no-op, not a transition
  return (graph[from] ?? []).includes(to);
}

// --- policyDecision -------------------------------------------------------------------------
// Set by (re-)evaluation. A provider failure yields UNKNOWN rather than a false BLOCK (API
// contract "Canonical business models"); once fresh evaluation succeeds it settles into one of
// the three concrete decisions. Any concrete decision can be re-evaluated against a fresh intent
// version, since capacity/policy state can change between versions.
const POLICY_DECISION_GRAPH: Graph<PolicyDecisionWire> = {
  UNKNOWN: ['ALLOW', 'ESCALATE', 'BLOCK'],
  ALLOW: ['ESCALATE', 'BLOCK', 'UNKNOWN'],
  ESCALATE: ['ALLOW', 'BLOCK', 'UNKNOWN'],
  BLOCK: ['ALLOW', 'ESCALATE', 'UNKNOWN'],
};

export function isPolicyDecisionTransitionAllowed(
  from: PolicyDecisionWire,
  to: PolicyDecisionWire,
): boolean {
  return isAllowed(POLICY_DECISION_GRAPH, from, to);
}

// --- executionStatus -------------------------------------------------------------------------
// Mirrors ARCH 3.4's recovery table directly: a reverted/cancelled attempt does not permanently
// block the invoice (CLAUDE.md invariant) -- both flow back to READY for a fresh attempt. UNKNOWN
// is reachable from SUBMITTED (RPC timeout) and resolves forward to INCLUDED/REVERTED/CANCELLED,
// or back to SUBMITTED on a same-hash reconcile. REORGED is reachable from any post-inclusion
// state and resolves back to UNKNOWN for re-observation.
const EXECUTION_STATUS_GRAPH: Graph<ExecutionStatusWire> = {
  DRAFT: ['AWAITING_APPROVAL', 'READY', 'CANCELLED'],
  // SPEC-030: submit queues regardless of whether an ESCALATE payment's approval has arrived yet
  // -- the API layer does not pre-judge that, the worker re-evaluates and rejects with
  // APPROVAL_REQUIRED (a normal CANCELLED outcome) if it's still missing. AWAITING_APPROVAL must
  // therefore be able to reach QUEUED directly, not only READY.
  AWAITING_APPROVAL: ['READY', 'QUEUED', 'CANCELLED'],
  READY: ['QUEUED', 'CANCELLED'],
  QUEUED: ['SIGNED', 'CANCELLED'],
  SIGNED: ['SUBMITTED'],
  // SPEC-029: a real `eth_getTransactionReceipt` reveals inclusion AND success/revert in the SAME
  // RPC response -- there is no separate "included, outcome still unknown" moment worth forcing
  // through an intermediate write. SUCCEEDED/REVERTED are therefore reachable directly from
  // SUBMITTED (and from UNKNOWN, alongside the REVERTED edge this graph already had), while
  // INCLUDED remains reachable too for a caller that deliberately wants a two-phase observation.
  SUBMITTED: ['UNKNOWN', 'INCLUDED', 'SUCCEEDED', 'REVERTED'],
  // SPEC-034: REORGED always resolves to UNKNOWN, but before this edge existed UNKNOWN had no way
  // back to READY -- a reorg-regressed payment (reasonCode ORPHANED_BLOCK) was permanently
  // stranded, since REVERTED/CANCELLED both already have this same edge for the identical "fresh
  // attempt is legitimate" reason. The READ/SUBMIT layer (not this graph) is responsible for never
  // taking this edge while reconciliation is still the sticky MISMATCH value -- this graph only
  // says the transition is structurally possible, exactly like every other edge here.
  UNKNOWN: ['SUBMITTED', 'INCLUDED', 'SUCCEEDED', 'REVERTED', 'CANCELLED', 'READY'],
  INCLUDED: ['SUCCEEDED', 'REVERTED', 'REORGED'],
  SUCCEEDED: ['REORGED'],
  REVERTED: ['REORGED', 'READY'],
  CANCELLED: ['READY'],
  REORGED: ['UNKNOWN'],
};

export function isExecutionStatusTransitionAllowed(
  from: ExecutionStatusWire,
  to: ExecutionStatusWire,
): boolean {
  return isAllowed(EXECUTION_STATUS_GRAPH, from, to);
}

// --- confidence ------------------------------------------------------------------------------
// A monotonic ladder toward the deployment's configured confidencePolicy ceiling, plus reorg
// regression back to UNOBSERVED from any level (ARCH 3.4: "On reorg ... never silently claim
// payment remained final"). SPEC-029's rationale extends here too: a receipt observation reveals
// inclusion and the LOCAL_DEMO ceiling simultaneously (auto-mined blocks have no meaningful
// separate "included, demo-confidence not yet assigned" moment), so UNOBSERVED -> LOCAL_DEMO is
// direct, alongside the real-network two-step path through INCLUDED.
const CONFIDENCE_GRAPH: Graph<ConfidenceWire> = {
  UNOBSERVED: ['INCLUDED', 'LOCAL_DEMO'],
  INCLUDED: ['DEPTH_CONFIRMED', 'RPC_FINALIZED', 'LOCAL_DEMO', 'UNOBSERVED'],
  DEPTH_CONFIRMED: ['RPC_FINALIZED', 'UNOBSERVED'],
  RPC_FINALIZED: ['UNOBSERVED'],
  LOCAL_DEMO: ['UNOBSERVED'],
};

export function isConfidenceTransitionAllowed(from: ConfidenceWire, to: ConfidenceWire): boolean {
  return isAllowed(CONFIDENCE_GRAPH, from, to);
}

// --- reconciliation --------------------------------------------------------------------------
// MISMATCH is sticky by design (ARCH 3.4: "A mismatch disables further automatic execution ...
// it never triggers an automatic second payment") -- reaching MATCHED from MISMATCH requires an
// explicit re-check cycle back through NOT_CHECKED first, not a direct flip, so the sticky state
// is never silently cleared by the same code path that produced it.
const RECONCILIATION_GRAPH: Graph<ReconciliationWire> = {
  NOT_CHECKED: ['MATCHED', 'MISMATCH'],
  MATCHED: ['NOT_CHECKED'],
  MISMATCH: ['NOT_CHECKED'],
};

export function isReconciliationTransitionAllowed(
  from: ReconciliationWire,
  to: ReconciliationWire,
): boolean {
  return isAllowed(RECONCILIATION_GRAPH, from, to);
}

// --- operation status --------------------------------------------------------------------------
const OPERATION_STATUS_GRAPH: Graph<OperationStatusWire> = {
  QUEUED: ['IN_PROGRESS', 'FAILED'],
  IN_PROGRESS: ['COMPLETED', 'UNKNOWN', 'FAILED'],
  UNKNOWN: ['IN_PROGRESS', 'COMPLETED', 'FAILED'],
  FAILED: ['IN_PROGRESS'],
  COMPLETED: [],
};

export function isOperationStatusTransitionAllowed(
  from: OperationStatusWire,
  to: OperationStatusWire,
): boolean {
  return isAllowed(OPERATION_STATUS_GRAPH, from, to);
}

// --- transaction_attempts.state (Stage 3 addition, SPEC-013; SPEC-029 edges added Stage 5) ---
// Not a domain wire type -- this axis is internal to the transaction-journal repository, never
// exposed across the API boundary directly (executionStatus is the public-facing projection of
// it). SIGNED->SUBMITTED is the first broadcast; UNKNOWN is an RPC-timeout observation state that
// resolves forward like executionStatus's UNKNOWN does; REPLACED is terminal (the fee-bump attempt
// becomes canonical instead); REORGED resolves back to UNKNOWN for re-observation, mirroring
// executionStatus's own reorg-regression rule. SUCCEEDED/REVERTED are reachable directly from
// SUBMITTED and UNKNOWN (not only via INCLUDED) for the same reason as EXECUTION_STATUS_GRAPH:
// `eth_getTransactionReceipt` reveals inclusion and outcome in one response.
export type TransactionAttemptState =
  | 'SIGNED'
  | 'SUBMITTED'
  | 'UNKNOWN'
  | 'INCLUDED'
  | 'SUCCEEDED'
  | 'REVERTED'
  | 'REPLACED'
  | 'CANCELLED'
  | 'REORGED';

const TRANSACTION_ATTEMPT_STATE_GRAPH: Graph<TransactionAttemptState> = {
  SIGNED: ['SUBMITTED', 'REPLACED', 'CANCELLED'],
  SUBMITTED: ['UNKNOWN', 'INCLUDED', 'SUCCEEDED', 'REVERTED', 'REPLACED', 'CANCELLED'],
  UNKNOWN: ['SUBMITTED', 'INCLUDED', 'SUCCEEDED', 'REVERTED', 'REPLACED', 'CANCELLED'],
  INCLUDED: ['SUCCEEDED', 'REVERTED', 'REORGED'],
  SUCCEEDED: ['REORGED'],
  REVERTED: ['REORGED'],
  REPLACED: [],
  CANCELLED: [],
  REORGED: ['UNKNOWN'],
};

export function isTransactionAttemptStateTransitionAllowed(
  from: TransactionAttemptState,
  to: TransactionAttemptState,
): boolean {
  return isAllowed(TRANSACTION_ATTEMPT_STATE_GRAPH, from, to);
}
