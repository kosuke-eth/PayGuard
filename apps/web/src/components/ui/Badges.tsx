import { EXECUTION_TEXT } from '../../lib/labels';
import type { ExecutionStatus, PolicyDecision } from '../../lib/types';

/** Each verdict has its own shape as well as its own colour, so colour is never the only cue. */
function VerdictShape({ decision }: { decision: PolicyDecision }) {
  if (decision === 'ALLOW') {
    return (
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M1.5 6.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" />
      </svg>
    );
  }
  if (decision === 'ESCALATE') {
    return (
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 1l5 10H1z" fill="currentColor" />
      </svg>
    );
  }
  if (decision === 'BLOCK') {
    return (
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <rect x="1" y="4" width="10" height="4" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function DecisionBadge({ decision }: { decision: PolicyDecision }) {
  return (
    <span className={`verdict verdict-${decision}`}>
      <VerdictShape decision={decision} />
      {decision}
    </span>
  );
}

function executionTone(status: ExecutionStatus): string {
  if (status === 'SUCCEEDED') return 'exec-done';
  if (status === 'REVERTED' || status === 'REORGED') return 'exec-bad';
  if (status === 'AWAITING_APPROVAL') return 'exec-wait';
  if (['QUEUED', 'SIGNED', 'SUBMITTED', 'INCLUDED', 'UNKNOWN'].includes(status)) return 'exec-live';
  return '';
}

/**
 * Execution state is a separate axis from the policy decision. A blocked payment never reached
 * execution, so it is worded as "no settlement" rather than as a draft or a failure.
 */
export function ExecutionBadge({
  status,
  decision,
}: {
  status: ExecutionStatus;
  decision: PolicyDecision;
}) {
  if (decision === 'BLOCK') {
    return (
      <span className="exec">
        <i />
        No settlement submitted
      </span>
    );
  }
  return (
    <span className={`exec ${executionTone(status)}`}>
      <i />
      {EXECUTION_TEXT[status] ?? status}
    </span>
  );
}
