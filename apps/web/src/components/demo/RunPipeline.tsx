import type { ReactNode } from 'react';
import { reasonText } from '../../lib/errors';
import { findRoute, needsOwnerApproval, routeLabel } from '../../lib/labels';
import type { DemoRun, PaymentDetail } from '../../lib/types';
import { useConfig } from '../../state/app';
import { Amount, Hex } from '../ui/Amount';
import { DecisionBadge } from '../ui/Badges';

type Tone = 'done' | 'live' | 'wait' | 'stop' | 'idle';
interface Step {
  tone: Tone;
  title: string;
  detail?: ReactNode;
}

const MARK: Record<Tone, string> = { done: '✓', stop: '×', wait: '!', live: '', idle: '' };

/**
 * Every step is derived from a field the backend returned for THIS run or its payment. A step
 * with no evidence yet stays idle; nothing advances on a timer.
 */
function buildSteps(
  run: DemoRun,
  payment: PaymentDetail | null,
  routeName: string,
  onApprovals: () => void,
): Step[] {
  const steps: Step[] = [];
  const status = payment?.executionStatus ?? run.livePaymentStatus?.executionStatus ?? null;
  const decision = payment?.policyDecision ?? run.livePaymentStatus?.policyDecision ?? null;

  if (run.orchestrationStatus === 'REJECTED_INVALID_SIGNATURE') {
    return [
      {
        tone: 'stop',
        title: 'Invoice rejected',
        detail: (
          <>
            The signer is not a merchant this vault registered. No payment was created and nothing
            reached the chain. <span className="mono">{run.errorCode}</span>
          </>
        ),
      },
    ];
  }

  steps.push({
    tone: 'done',
    title: 'Merchant invoice signed and accepted',
    detail: 'Signed by the seeded demo merchant key, verified by the API.',
  });
  steps.push(
    run.intentId
      ? {
          tone: 'done',
          title: 'Agent signed a bounded payment intent',
          detail: (
            <>
              Intent <Hex value={run.intentId} />
            </>
          ),
        }
      : { tone: 'idle', title: 'Agent signs a bounded payment intent' },
  );

  if (run.orchestrationStatus === 'DUPLICATE_NOT_PAID_TWICE') {
    steps.push({
      tone: 'stop',
      title: 'Duplicate refused — the invoice was not paid twice',
      detail: (
        <>
          The second attempt resolved to the same obligation.{' '}
          <span className="mono">{run.errorCode}</span>
        </>
      ),
    });
    return steps;
  }

  if (!decision) {
    steps.push({ tone: 'live', title: 'PayGuard is evaluating' });
    return steps;
  }
  steps.push({
    tone:
      decision === 'ALLOW'
        ? 'done'
        : decision === 'ESCALATE'
          ? 'wait'
          : decision === 'BLOCK'
            ? 'stop'
            : 'wait',
    title: 'PayGuard evaluated the payment on-chain',
    detail: (
      <>
        <DecisionBadge decision={decision} />{' '}
        {decision === 'UNKNOWN'
          ? 'The chain could not be read. This is unknown, not a block.'
          : reasonText(payment?.reasonCode ?? run.errorCode)}
      </>
    ),
  });
  if (decision === 'BLOCK') {
    steps.push({
      tone: 'stop',
      title: 'No settlement submitted',
      detail: 'Funds moved: 0. There is no transaction, because none was sent.',
    });
    return steps;
  }

  if (decision === 'ESCALATE') {
    const waiting = needsOwnerApproval(decision, status, payment?.reasonCode ?? run.errorCode);
    steps.push(
      waiting
        ? {
            tone: 'wait',
            title: 'Waiting for the owner’s exact approval',
            detail: (
              <button type="button" className="btn btn-primary" onClick={onApprovals}>
                Open approvals
              </button>
            ),
          }
        : { tone: 'done', title: 'Owner signed the exact approval' },
    );
    if (waiting) return steps;
  }

  const hash = payment?.transaction?.hash;
  steps.push(
    hash
      ? {
          tone: 'done',
          title: `Relayer submitted settlement via ${routeName}`,
          detail: <Hex value={hash} />,
        }
      : {
          tone: status === 'CANCELLED' ? 'stop' : 'live',
          title: status === 'CANCELLED' ? 'Cancelled before submission' : 'Queued for the relayer',
          detail:
            status === 'CANCELLED'
              ? (reasonText(payment?.reasonCode ?? run.errorCode) ?? undefined)
              : undefined,
        },
  );
  if (!hash) return steps;

  if (status === 'REVERTED') {
    steps.push({
      tone: 'stop',
      title: 'Transaction reverted',
      detail: 'No PayGuard payment was completed. The invoice is still unpaid.',
    });
    return steps;
  }
  if (status === 'UNKNOWN') {
    steps.push({
      tone: 'wait',
      title: 'Inclusion unknown',
      detail: 'PayGuard cannot confirm the transaction yet and is reconciling.',
    });
    return steps;
  }
  const included = status === 'INCLUDED' || status === 'SUCCEEDED';
  steps.push(
    included
      ? {
          tone: 'done',
          title: `Transaction included${payment?.observedAt?.blockNumber ? ` in block ${payment.observedAt.blockNumber}` : ''}`,
        }
      : { tone: 'live', title: 'Waiting for inclusion' },
  );
  steps.push(
    payment?.settlement
      ? {
          tone: 'done',
          title: 'Merchant received the exact amount',
          detail: (
            <>
              <Amount
                atomic={payment.settlement.outputDeliveredAtomic}
                token={payment.invoice?.outputToken}
                precise
              />{' '}
              delivered ·{' '}
              <Amount
                atomic={payment.settlement.actualInputAtomic}
                token={payment.authorized?.inputToken}
                precise
              />{' '}
              taken from the vault
            </>
          ),
        }
      : { tone: included ? 'live' : 'idle', title: 'Merchant receipt verified' },
  );
  return steps;
}

export function RunPipeline({
  run,
  payment,
  onApprovals,
}: {
  run: DemoRun;
  payment: PaymentDetail | null;
  onApprovals: () => void;
}) {
  const config = useConfig();
  const routeName = routeLabel(findRoute(config, payment?.authorized?.routeId)?.kind);
  const steps = buildSteps(run, payment, routeName, onApprovals);
  return (
    <ol className="steps">
      {steps.map((step) => (
        <li key={step.title} className={`step-${step.tone}`}>
          <span className="step-dot">{MARK[step.tone]}</span>
          <div>
            <div style={{ fontWeight: 500 }}>{step.title}</div>
            {step.detail && (
              <div className="small muted" style={{ marginTop: 2 }}>
                {step.detail}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
