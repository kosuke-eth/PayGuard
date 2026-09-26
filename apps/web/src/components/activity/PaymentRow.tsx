import { findRoute, formatTime, routeLabel, shortHex } from '../../lib/labels';
import type { PaymentRecord } from '../../lib/types';
import { useConfig } from '../../state/app';
import { useNames } from '../../state/names';
import { Amount } from '../ui/Amount';
import { DecisionBadge, ExecutionBadge } from '../ui/Badges';

export function PaymentRow({
  record,
  label,
  onOpen,
}: {
  record: PaymentRecord;
  label: string | null;
  onOpen: (paymentId: string) => void;
}) {
  const config = useConfig();
  const { nameOf } = useNames();
  const name = nameOf(record.invoice?.recipient) ?? label;
  const route = findRoute(config, record.authorized?.routeId);
  return (
    <button
      type="button"
      className={`log-row decision-${record.policyDecision}`}
      onClick={() => onOpen(record.paymentId)}
    >
      <span className="when small muted num">{formatTime(record.createdAt)}</span>
      <span>
        {name ?? <span className="mono">{shortHex(record.invoice?.recipient)}</span>}
        {name && <span className="small muted mono"> {shortHex(record.invoice?.recipient)}</span>}
      </span>
      <span className="amount">
        <Amount atomic={record.invoice?.outputAmountAtomic} token={record.invoice?.outputToken} />
      </span>
      <span>
        <DecisionBadge decision={record.policyDecision} />
      </span>
      <span className="route">
        <ExecutionBadge status={record.executionStatus} decision={record.policyDecision} />
        <span className="small muted"> · {routeLabel(route?.kind)}</span>
      </span>
    </button>
  );
}
