import { useEffect, useRef } from 'react';
import { formatAtomic } from '../lib/amounts';
import { reasonText } from '../lib/errors';
import { findToken, shortHex } from '../lib/labels';
import type { PaymentRecord } from '../lib/types';
import { useConfig } from '../state/app';
import { useNames } from '../state/names';
import { useToasts } from '../state/toasts';

/**
 * Turns CHANGES between two backend reads into notifications: a payment that newly needs the
 * owner, was newly blocked, or newly reached a verified settlement. The first read after sign-in
 * only sets the baseline, so history never replays as news.
 */
export function usePaymentNotifications(
  records: PaymentRecord[] | null,
  labelFor: (paymentId: string) => string | null,
  actions: { review: () => void; open: (paymentId: string) => void },
) {
  const config = useConfig();
  const { nameOf } = useNames();
  const { push } = useToasts();
  const seen = useRef<Map<string, string> | null>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // biome-ignore lint/correctness/useExhaustiveDependencies: fire on new backend data only
  useEffect(() => {
    if (!records) return;
    const next = new Map(
      records.map((r) => [r.paymentId, `${r.policyDecision}:${r.executionStatus}`]),
    );
    const previous = seen.current;
    seen.current = previous ? new Map([...previous, ...next]) : next;
    if (!previous) return;

    for (const record of records) {
      const before = previous.get(record.paymentId);
      const now = next.get(record.paymentId);
      if (before === now) continue;
      const token = findToken(config, record.invoice?.outputToken);
      const amount = token
        ? `${formatAtomic(record.invoice?.outputAmountAtomic, token.decimals)} ${token.symbol}`
        : 'a payment';
      const who =
        nameOf(record.invoice?.recipient) ??
        labelFor(record.paymentId) ??
        shortHex(record.invoice?.recipient);

      if (record.executionStatus === 'AWAITING_APPROVAL') {
        push({
          tone: 'escalate',
          title: `Approval needed: ${amount}`,
          text: `To ${who}. It is above your automatic limit.`,
          action: { label: 'Review', run: () => actionsRef.current.review() },
        });
      } else if (record.policyDecision === 'BLOCK' && !before) {
        push({
          tone: 'block',
          title: `Blocked: ${amount} to ${who}`,
          text: reasonText(record.reasonCode) ?? 'Outside your policy. No funds moved.',
          action: { label: 'Details', run: () => actionsRef.current.open(record.paymentId) },
        });
      } else if (record.executionStatus === 'SUCCEEDED') {
        push({
          tone: 'allow',
          title: `Paid: ${amount} to ${who}`,
          text: 'Settlement verified on-chain.',
          action: { label: 'Receipt', run: () => actionsRef.current.open(record.paymentId) },
        });
      } else if (record.executionStatus === 'REVERTED') {
        push({
          tone: 'block',
          title: `Settlement reverted: ${amount}`,
          text: 'No payment was completed.',
          action: { label: 'Details', run: () => actionsRef.current.open(record.paymentId) },
        });
      }
    }
  }, [records]);
}
