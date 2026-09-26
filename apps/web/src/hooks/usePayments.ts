import { isInFlight } from '../lib/labels';
import { loadPaymentPage, type PaymentPage } from '../lib/payments';
import { useApp } from '../state/app';
import { usePolling } from './usePolling';

/** First page of the owner's durable payments. Polls fast only while something is in flight. */
export function usePayments(status?: string) {
  const { session, handleApiError } = useApp();
  const owner = session?.walletAddress ?? null;
  return usePolling<PaymentPage>(
    owner ? `payments:${owner}:${status ?? 'all'}` : null,
    () => loadPaymentPage(status ? { status } : {}),
    (data) =>
      data?.records.some((record) => isInFlight(record.executionStatus, record.policyDecision))
        ? 3000
        : 8000,
    handleApiError,
  );
}
