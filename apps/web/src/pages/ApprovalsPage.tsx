import { useState } from 'react';
import { ApprovalCard } from '../components/approvals/ApprovalCard';
import { Amount } from '../components/ui/Amount';
import { DecisionBadge, ExecutionBadge } from '../components/ui/Badges';
import { ErrorNotice, StaleNote } from '../components/ui/ErrorNotice';
import type { Polled } from '../hooks/usePolling';
import { usePolling } from '../hooks/usePolling';
import { isInFlight, shortHex } from '../lib/labels';
import { api } from '../lib/payguard-client';
import type { PaymentPage } from '../lib/payments';
import { useApp } from '../state/app';

/**
 * Once signed and submitted, a payment leaves the AWAITING_APPROVAL list. This keeps it on screen
 * and follows its real execution status, so the owner sees what their signature led to.
 */
function SignedFollowUp({
  paymentId,
  label,
  onOpenPayment,
}: {
  paymentId: string;
  label: string | null;
  onOpenPayment: (id: string) => void;
}) {
  const payment = usePolling(
    `approved:${paymentId}`,
    () => api.getPayment(paymentId),
    (data) =>
      !data ||
      isInFlight(data.executionStatus, data.policyDecision) ||
      data.executionStatus === 'AWAITING_APPROVAL'
        ? 2500
        : null,
  );
  const p = payment.data;
  return (
    <div className="panel stack" style={{ borderTop: '4px solid var(--royal)' }} role="status">
      <div className="spread">
        <strong>You signed this approval</strong>
        <button type="button" className="btn btn-quiet" onClick={() => onOpenPayment(paymentId)}>
          Open receipt
        </button>
      </div>
      {p ? (
        <>
          <div>
            {label ?? shortHex(p.invoice?.recipient)} ·{' '}
            <Amount atomic={p.invoice?.outputAmountAtomic} token={p.invoice?.outputToken} />
          </div>
          <div className="row">
            <DecisionBadge decision={p.policyDecision} />
            <ExecutionBadge status={p.executionStatus} decision={p.policyDecision} />
          </div>
          <p className="small muted">
            {p.executionStatus === 'SUCCEEDED'
              ? 'A verified receipt shows the merchant was paid.'
              : 'Your signature is stored and the intent is queued. The merchant is not paid until a verified receipt exists.'}
          </p>
        </>
      ) : (
        <p className="muted small">Reading the payment’s current status…</p>
      )}
    </div>
  );
}

export function ApprovalsPage({
  pending,
  labelFor,
  onOpenPayment,
  onChanged,
}: {
  pending: Polled<PaymentPage>;
  labelFor: (paymentId: string) => string | null;
  onOpenPayment: (paymentId: string) => void;
  onChanged: () => void;
}) {
  const { profiles } = useApp();
  const [signed, setSigned] = useState<string[]>([]);
  const records = pending.data?.records ?? [];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p>
            Payments PayGuard escalated to you. They are listed for every vault you own and stay
            here, across reloads, until you sign them or they expire.
          </p>
        </div>
      </div>
      <StaleNote refreshedAt={pending.refreshedAt} error={pending.error} />
      {pending.error && !pending.data && (
        <ErrorNotice error={pending.error} onRetry={() => void pending.refresh()} />
      )}
      {pending.loading && !pending.data && <p className="muted">Loading escalated payments…</p>}
      {pending.data && records.length === 0 && signed.length === 0 && (
        <div className="panel empty empty-quiet">
          <strong>Nothing is waiting for you.</strong>
          <span>Payments inside the automatic limit settle on their own.</span>
        </div>
      )}
      <div className="stack" style={{ maxWidth: 640 }}>
        {signed.map((paymentId) => (
          <SignedFollowUp
            key={paymentId}
            paymentId={paymentId}
            label={labelFor(paymentId)}
            onOpenPayment={onOpenPayment}
          />
        ))}
        {records
          .filter((record) => !signed.includes(record.paymentId))
          .map((record) => (
            <ApprovalCard
              key={record.paymentId}
              payment={record}
              profile={profiles?.find((profile) => profile.vault.vaultId === record.vaultId)}
              label={labelFor(record.paymentId)}
              onOpenPayment={onOpenPayment}
              onChanged={(paymentId) => {
                setSigned((previous) => [paymentId, ...previous]);
                onChanged();
              }}
            />
          ))}
      </div>
    </>
  );
}
