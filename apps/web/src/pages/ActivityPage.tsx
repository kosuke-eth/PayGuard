import { useEffect, useState } from 'react';
import { PaymentRow } from '../components/activity/PaymentRow';
import { ErrorNotice, StaleNote } from '../components/ui/ErrorNotice';
import type { Polled } from '../hooks/usePolling';
import { formatAtomic } from '../lib/amounts';
import { toUiError, type UiError } from '../lib/errors';
import { findRoute, findToken, routeLabel } from '../lib/labels';
import { loadPaymentPage, type PaymentPage } from '../lib/payments';
import type { PaymentRecord, PolicyDecision, Profile } from '../lib/types';
import { useConfig } from '../state/app';
import { useNames } from '../state/names';

type Filter = 'ALL' | PolicyDecision;
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'ALLOW', label: 'Allowed' },
  { key: 'ESCALATE', label: 'Escalated' },
  { key: 'BLOCK', label: 'Blocked' },
];

export function ActivityPage({
  profile,
  payments,
  labelFor,
  onOpenPayment,
}: {
  profile: Profile;
  payments: Polled<PaymentPage>;
  labelFor: (paymentId: string) => string | null;
  onOpenPayment: (paymentId: string) => void;
}) {
  const config = useConfig();
  const { nameOf } = useNames();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [older, setOlder] = useState<PaymentRecord[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<UiError | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset paging when the profile changes
  useEffect(() => {
    setOlder([]);
    setCursor(undefined);
  }, [profile.id]);

  const nextCursor = cursor === undefined ? (payments.data?.nextCursor ?? null) : cursor;

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await loadPaymentPage({ cursor: nextCursor });
      setOlder((previous) => [...previous, ...page.records]);
      setCursor(page.nextCursor);
    } catch (caught) {
      setMoreError(toUiError(caught));
    } finally {
      setLoadingMore(false);
    }
  }

  const seen = new Set<string>();
  const all = [...(payments.data?.records ?? []), ...older].filter((record) => {
    if (record.vaultId !== profile.vault.vaultId || seen.has(record.paymentId)) return false;
    seen.add(record.paymentId);
    return true;
  });
  const needle = search.trim().toLowerCase();
  const shown = all.filter((record) => {
    if (filter !== 'ALL' && record.policyDecision !== filter) return false;
    if (!needle) return true;
    const name = nameOf(record.invoice?.recipient) ?? labelFor(record.paymentId) ?? '';
    return [name, record.invoice?.recipient, record.transaction?.hash, record.paymentId].some(
      (value) => value?.toLowerCase().includes(needle),
    );
  });

  const groups: Array<{ day: string; records: PaymentRecord[] }> = [];
  for (const record of shown) {
    const day = new Date(record.createdAt).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.records.push(record);
    else groups.push({ day, records: [record] });
  }

  /** Exports exactly the rows on screen, with atomic amounts kept alongside the formatted ones. */
  function exportCsv() {
    const header = [
      'created_at',
      'merchant_name',
      'recipient',
      'amount',
      'token',
      'amount_atomic',
      'decision',
      'execution_status',
      'reason_code',
      'route',
      'actual_input_atomic',
      'tx_hash',
      'payment_id',
    ];
    const rows = shown.map((record) => {
      const token = findToken(config, record.invoice?.outputToken);
      return [
        record.createdAt,
        nameOf(record.invoice?.recipient) ?? labelFor(record.paymentId) ?? '',
        record.invoice?.recipient ?? '',
        token
          ? formatAtomic(record.invoice?.outputAmountAtomic, token.decimals, {
              maxFraction: token.decimals,
            }).replace(/,/g, '')
          : '',
        token?.symbol ?? '',
        record.invoice?.outputAmountAtomic ?? '',
        record.policyDecision,
        record.executionStatus,
        record.reasonCode ?? '',
        routeLabel(findRoute(config, record.authorized?.routeId)?.kind),
        record.settlement?.actualInputAtomic ?? '',
        record.transaction?.hash ?? '',
        record.paymentId,
      ];
    });
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `payguard-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p>
            Every payment this agent proposed. The decision says what the policy ruled; the status
            says what actually happened on-chain. They are separate on purpose.
          </p>
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would bring legend/border styling for a simple toggle row */}
        <div className="segmented" role="group" aria-label="Filter by decision">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={filter === option.key}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <StaleNote refreshedAt={payments.refreshedAt} error={payments.error} />
      {payments.error && !payments.data && (
        <ErrorNotice error={payments.error} onRetry={() => void payments.refresh()} />
      )}

      <section className="panel">
        {payments.loading && !payments.data && (
          <p className="muted">Loading durable payment history…</p>
        )}
        <div className="toolbar">
          <input
            className="input"
            type="search"
            placeholder="Search merchant, address or transaction"
            aria-label="Search activity"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="button" className="btn" disabled={shown.length === 0} onClick={exportCsv}>
            Export CSV
          </button>
        </div>
        {groups.length > 0 && (
          <div className="log-head" aria-hidden="true">
            <span>When</span>
            <span>Merchant</span>
            <span>Amount</span>
            <span>Decision</span>
            <span>What happened</span>
          </div>
        )}
        {groups.map((group) => (
          <div key={group.day}>
            <div className="day-head">{group.day}</div>
            <div className="log">
              {group.records.map((record) => (
                <PaymentRow
                  key={record.paymentId}
                  record={record}
                  label={labelFor(record.paymentId)}
                  onOpen={onOpenPayment}
                />
              ))}
            </div>
          </div>
        ))}
        {payments.data && shown.length === 0 && (
          <div className="empty">
            {needle
              ? 'Nothing in the loaded activity matches your search.'
              : filter === 'ALL'
                ? 'No payments from this agent yet.'
                : 'No payments with this decision in the loaded activity.'}
          </div>
        )}
        <div className="spread" style={{ marginTop: 14 }}>
          <span className="small muted">
            {shown.length} shown{filter !== 'ALL' ? ' in loaded activity' : ''}
            {nextCursor ? ' · older payments not loaded yet' : ''}
          </span>
          {nextCursor && (
            <button
              type="button"
              className="btn"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? 'Loading…' : 'Load older payments'}
            </button>
          )}
        </div>
        {moreError && <ErrorNotice error={moreError} />}
      </section>
      <p className="small muted">
        A request rejected before a payment existed (for example an invoice with an invalid
        signature) has no payment record. Test runs like that are listed under Test payments.
      </p>
    </>
  );
}
