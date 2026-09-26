import { usePolling } from '../../hooks/usePolling';
import { useStoredRuns } from '../../hooks/useRunLabels';
import { reasonText } from '../../lib/errors';
import { findRoute, formatTime, isInFlight, routeLabel, shortHex } from '../../lib/labels';
import { api } from '../../lib/payguard-client';
import { useApp, useConfig } from '../../state/app';
import { Amount, Hex } from '../ui/Amount';
import { DecisionBadge, ExecutionBadge } from '../ui/Badges';
import { Drawer } from '../ui/Drawer';
import { ErrorNotice, StaleNote } from '../ui/ErrorNotice';
import { Party } from '../ui/Party';
import { VerdictGate } from './VerdictGate';

export function ReceiptDrawer({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  const config = useConfig();
  const { handleApiError } = useApp();
  const { labelFor } = useStoredRuns();

  const payment = usePolling(
    `payment:${paymentId}`,
    () => api.getPayment(paymentId),
    (data) => (!data || isInFlight(data.executionStatus, data.policyDecision) ? 2500 : null),
    handleApiError,
  );
  const timeline = usePolling(
    `timeline:${paymentId}:${payment.data?.executionStatus ?? ''}`,
    () => api.getTimeline(paymentId),
    () => null,
  );
  const txHash = payment.data?.transaction?.hash ?? null;
  const transaction = usePolling(
    txHash ? `tx:${txHash}:${payment.data?.executionStatus ?? ''}` : null,
    () => api.getTransaction(txHash as string, config.deploymentId),
    () => null,
  );

  const p = payment.data;
  const title = !p
    ? 'Payment'
    : p.policyDecision === 'BLOCK'
      ? 'Payment blocked'
      : p.executionStatus === 'SUCCEEDED'
        ? 'Payment settled'
        : p.executionStatus === 'AWAITING_APPROVAL'
          ? 'Approval required'
          : 'Payment in progress';

  const route = p ? findRoute(config, p.authorized?.routeId) : undefined;
  const reason = p ? reasonText(p.reasonCode) : null;

  return (
    <Drawer title={title} onClose={onClose}>
      {payment.loading && !p && <p className="muted">Loading the canonical payment record…</p>}
      {payment.error && !p && (
        <ErrorNotice error={payment.error} onRetry={() => void payment.refresh()} />
      )}
      {p && (
        <>
          <StaleNote refreshedAt={payment.refreshedAt} error={payment.error} />
          <div className="stack" style={{ gap: 6 }}>
            <Party
              address={p.invoice?.recipient}
              suggested={labelFor(p.paymentId)}
              kind="merchant"
            />
            <div style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em' }}>
              <Amount
                atomic={p.invoice?.outputAmountAtomic}
                token={p.invoice?.outputToken}
                precise
              />
            </div>
            <div className="row">
              <DecisionBadge decision={p.policyDecision} />
              <ExecutionBadge status={p.executionStatus} decision={p.policyDecision} />
            </div>
          </div>

          <VerdictGate decision={p.policyDecision} status={p.executionStatus} compact />

          {p.policyDecision === 'BLOCK' && (
            <div className="notice notice-POLICY">
              <div className="notice-title">{reason ?? 'Blocked by policy.'}</div>
              <div className="small">No settlement was submitted. Funds moved: 0.</div>
              {p.reasonCode && <div className="small mono muted">{p.reasonCode}</div>}
            </div>
          )}
          {p.policyDecision === 'UNKNOWN' && (
            <div className="notice notice-NETWORK">
              PayGuard could not evaluate this payment against the chain. That is an unknown state,
              not a block.
            </div>
          )}
          {p.executionStatus === 'UNKNOWN' && (
            <div className="notice notice-NETWORK">
              <div className="notice-title">Status unknown</div>
              PayGuard cannot confirm whether the transaction was included yet. It is reconciling;
              nothing is resubmitted blindly.
            </div>
          )}
          {p.executionStatus === 'REVERTED' && (
            <div className="notice notice-SETTLEMENT">
              <div className="notice-title">Settlement reverted</div>
              The route could not deliver the requested output within the authorized input limit. No
              PayGuard payment was completed; the invoice is still unpaid.
            </div>
          )}

          {p.settlement ? (
            <section className="stack" style={{ gap: 10 }}>
              <h3>Settlement</h3>
              <div className="flow">
                <div className="flow-node">
                  <Amount
                    atomic={p.settlement.actualInputAtomic}
                    token={p.authorized?.inputToken}
                    precise
                  />
                  <small>actual input taken from the vault</small>
                </div>
                <div className="flow-link" />
                <div className="flow-node">{routeLabel(route?.kind)}</div>
                <div className="flow-link" />
                <div className="flow-node">
                  <Amount
                    atomic={p.settlement.outputDeliveredAtomic}
                    token={p.invoice?.outputToken}
                    precise
                  />
                  <small>received by {shortHex(p.invoice?.recipient)}</small>
                </div>
              </div>
            </section>
          ) : (
            p.policyDecision !== 'BLOCK' && (
              <p className="muted small">
                Actual input and delivered output appear here only after a verified canonical
                receipt. Until then nothing has been paid.
              </p>
            )
          )}

          <dl className="ledger">
            <div>
              <dt>Requested output</dt>
              <dd>
                <Amount
                  atomic={p.invoice?.outputAmountAtomic}
                  token={p.invoice?.outputToken}
                  precise
                />
              </dd>
            </div>
            <div>
              <dt>Maximum input authorized</dt>
              <dd>
                <Amount
                  atomic={p.authorized?.maxInputAtomic}
                  token={p.authorized?.inputToken}
                  precise
                />
              </dd>
            </div>
            <div>
              <dt>Actual input</dt>
              <dd>
                {p.settlement ? (
                  <Amount
                    atomic={p.settlement.actualInputAtomic}
                    token={p.authorized?.inputToken}
                    precise
                  />
                ) : (
                  <span className="muted">not settled</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Merchant received</dt>
              <dd>
                {p.settlement ? (
                  <Amount
                    atomic={p.settlement.outputDeliveredAtomic}
                    token={p.invoice?.outputToken}
                    precise
                  />
                ) : (
                  <span className="muted">not settled</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Route</dt>
              <dd>{routeLabel(route?.kind)}</dd>
            </div>
          </dl>

          <details className="tech">
            <summary>Technical evidence</summary>
            <div>
              <dl className="ledger small">
                <div>
                  <dt>Payment ID</dt>
                  <dd>
                    <Hex value={p.paymentId} />
                  </dd>
                </div>
                <div>
                  <dt>Intent ID</dt>
                  <dd>
                    <Hex value={p.intentId} />
                  </dd>
                </div>
                <div>
                  <dt>Invoice ID</dt>
                  <dd>
                    <Hex value={p.invoice?.invoiceId} />
                  </dd>
                </div>
                <div>
                  <dt>Recipient</dt>
                  <dd>
                    <Hex value={p.invoice?.recipient} />
                  </dd>
                </div>
                <div>
                  <dt>Route ID</dt>
                  <dd>
                    <Hex value={p.authorized?.routeId} />
                  </dd>
                </div>
                <div>
                  <dt>Adapter</dt>
                  <dd>
                    <Hex value={route?.adapter} />
                  </dd>
                </div>
                <div>
                  <dt>Reason code</dt>
                  <dd className="mono">{p.reasonCode ?? '—'}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd className="mono">{p.confidence}</dd>
                </div>
                <div>
                  <dt>Reconciliation</dt>
                  <dd className="mono">{p.reconciliation}</dd>
                </div>
                <div>
                  <dt>Transaction</dt>
                  <dd>
                    <Hex value={p.transaction?.hash} />
                  </dd>
                </div>
                {p.transaction?.replacementOf && (
                  <div>
                    <dt>Replaces</dt>
                    <dd>
                      <Hex value={p.transaction.replacementOf} />
                    </dd>
                  </div>
                )}
                {transaction.data && (
                  <>
                    <div>
                      <dt>Transaction state</dt>
                      <dd className="mono">{transaction.data.state}</dd>
                    </div>
                    <div>
                      <dt>Relayer / nonce</dt>
                      <dd>
                        <Hex value={transaction.data.from} /> · {transaction.data.nonce ?? '—'}
                      </dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>Block</dt>
                  <dd className="mono">{p.observedAt?.blockNumber ?? '—'}</dd>
                </div>
                <div>
                  <dt>Block hash</dt>
                  <dd>
                    <Hex value={p.observedAt?.blockHash} />
                  </dd>
                </div>
                <div>
                  <dt>Canonical</dt>
                  <dd>
                    {p.observedAt
                      ? p.observedAt.canonical
                        ? 'Yes'
                        : 'No — this block was reorged out'
                      : '—'}
                  </dd>
                </div>
              </dl>
              <p className="small muted" style={{ marginTop: 8 }}>
                Hashes copy on click. This is a local chain, so there is no public explorer to link
                to.
              </p>
            </div>
          </details>

          <details className="tech">
            <summary>Timeline</summary>
            <div>
              {timeline.data && timeline.data.items.length === 0 && (
                <p className="small muted">No lifecycle events recorded.</p>
              )}
              <ol className="steps">
                {timeline.data?.items.map((entry) => (
                  <li key={entry.eventId} className="step-done">
                    <span
                      className="step-dot"
                      style={{ background: 'var(--ink-3)', borderColor: 'var(--ink-3)' }}
                    />
                    <div>
                      <div className="mono">{entry.type}</div>
                      <div className="small muted">{formatTime(entry.createdAt)}</div>
                    </div>
                  </li>
                ))}
              </ol>
              {timeline.error && <ErrorNotice error={timeline.error} />}
            </div>
          </details>
        </>
      )}
    </Drawer>
  );
}
