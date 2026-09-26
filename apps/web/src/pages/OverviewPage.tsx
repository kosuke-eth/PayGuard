import { PaymentRow } from '../components/activity/PaymentRow';
import { VerdictGate } from '../components/payments/VerdictGate';
import { BudgetMeter } from '../components/policy/BudgetMeter';
import { Amount, Hex } from '../components/ui/Amount';
import { ErrorNotice, StaleNote } from '../components/ui/ErrorNotice';
import { Party } from '../components/ui/Party';
import type { Polled } from '../hooks/usePolling';
import { subtractFloorZero } from '../lib/amounts';
import { findRoute, routeLabel, shortHex } from '../lib/labels';
import type { PaymentPage } from '../lib/payments';
import type { Profile } from '../lib/types';
import { useApp, useConfig } from '../state/app';
import { useNames } from '../state/names';

export function OverviewPage({
  profile,
  payments,
  pendingCount,
  labelFor,
  onOpenPayment,
  onOpenVault,
  onGo,
}: {
  profile: Profile;
  payments: Polled<PaymentPage>;
  pendingCount: number | null;
  labelFor: (paymentId: string) => string | null;
  onOpenPayment: (paymentId: string) => void;
  onOpenVault: () => void;
  onGo: (page: 'approvals' | 'activity' | 'demo') => void;
}) {
  const config = useConfig();
  const { profilesError, profilesRefreshedAt } = useApp();
  const { vault, policy } = profile;
  const route = findRoute(config, policy.config.routeId);
  const mine = payments.data?.records.filter((record) => record.vaultId === vault.vaultId) ?? [];
  const latest = mine[0] ?? null;
  const { nameOf } = useNames();
  const agentName = nameOf(policy.config.agent);
  const spent = policy.counters ? String(policy.counters.outputSpent) : null;
  const blocked = mine.filter((record) => record.policyDecision === 'BLOCK').length;
  const settled = mine.filter((record) => record.executionStatus === 'SUCCEEDED').length;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">Overview</p>
          <h1>{agentName ?? 'Your agent'} spends inside your limits</h1>
          <p>
            Every payment it proposes is checked on-chain against your policy before any funds move.
          </p>
          <div style={{ marginTop: 10 }}>
            <Party address={policy.config.agent} kind="agent" />
          </div>
        </div>
        <div className="row">
          <span className={`tag ${vault.executionPaused ? 'tag-warn' : ''}`}>
            {vault.executionPaused === null
              ? 'Status unknown'
              : vault.executionPaused
                ? 'Payments paused'
                : 'Payments running'}
          </span>
          <button type="button" className="btn" onClick={onOpenVault}>
            Vault controls
          </button>
        </div>
      </div>

      <section className="overview" aria-label="Spending position">
        <div className="overview-budget">
          <p className="kicker">Remaining budget</p>
          <p className="instrument-amount">
            {spent === null ? (
              <span className="muted">Unknown</span>
            ) : (
              <Amount
                atomic={subtractFloorZero(policy.config.totalOutputBudget, spent)}
                token={policy.config.settlementToken}
              />
            )}
          </p>
          <p className="small muted">
            of{' '}
            <Amount
              atomic={policy.config.totalOutputBudget}
              token={policy.config.settlementToken}
            />
            {spent !== null && (
              <>
                {' '}
                · <Amount atomic={spent} token={policy.config.settlementToken} /> spent · {settled}{' '}
                settled in recent activity
              </>
            )}
          </p>
          <BudgetMeter policy={policy} heading={false} />
        </div>
        <div className="overview-lanes">
          <article className="lane-card lane-ALLOW">
            <span className="kicker">Allow</span>
            <strong>
              up to{' '}
              <Amount
                atomic={policy.config.automaticOutputCap}
                token={policy.config.settlementToken}
              />
            </strong>
            <span className="small muted">Settles without you</span>
          </article>
          <article className="lane-card lane-ESCALATE">
            <span className="kicker">Escalate</span>
            <strong>
              up to{' '}
              <Amount
                atomic={policy.config.escalationOutputCap}
                token={policy.config.settlementToken}
              />
            </strong>
            <span className="small muted">Stops for your signature</span>
          </article>
          <article className="lane-card lane-BLOCK">
            <span className="kicker">Block</span>
            <strong>
              above{' '}
              <Amount
                atomic={policy.config.escalationOutputCap}
                token={policy.config.settlementToken}
              />
            </strong>
            <span className="small muted">Nothing is settled</span>
          </article>
        </div>
      </section>

      <div className="overview-stats">
        <button
          type="button"
          className={`stat ${pendingCount ? 'stat-hot' : ''}`}
          onClick={() => onGo('approvals')}
        >
          <span className="kicker">Waiting for you</span>
          <strong>{pendingCount ?? '—'}</strong>
          <span className="small muted">
            {pendingCount ? 'Review and sign' : 'Nothing to approve'}
          </span>
        </button>
        <button type="button" className="stat stat-block" onClick={() => onGo('activity')}>
          <span className="kicker">Blocked</span>
          <strong>{blocked}</strong>
          <span className="small muted">Refused before settlement</span>
        </button>
        <div className="stat stat-route">
          <span className="kicker">Route</span>
          <strong>{routeLabel(route?.kind)}</strong>
          <span className={`small ${policy.status === 'ACTIVE' ? 'muted' : ''}`}>
            Policy {policy.status}
          </span>
        </div>
      </div>

      <StaleNote refreshedAt={profilesRefreshedAt} error={profilesError} />

      <div className="grid-2">
        <section className="panel gate-stage">
          <div className="panel-head">
            <h2>Latest decision</h2>
            {latest && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => onOpenPayment(latest.paymentId)}
              >
                Open receipt
              </button>
            )}
          </div>
          <VerdictGate
            decision={latest?.policyDecision ?? null}
            status={latest?.executionStatus ?? null}
          />
          {!latest && !payments.loading && (
            <div className="empty">
              No payments from this agent yet.{' '}
              <button type="button" className="btn btn-quiet" onClick={() => onGo('demo')}>
                Send a test payment
              </button>
            </div>
          )}
        </section>

        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Vault</h2>
              <Hex value={vault.address} />
            </div>
            <dl className="ledger">
              {vault.balances.length === 0 && (
                <div>
                  <dt>Balances</dt>
                  <dd className="muted">unknown — chain not readable</dd>
                </div>
              )}
              {vault.balances.map((balance) => (
                <div key={balance.token}>
                  <dt>
                    {balance.symbol}{' '}
                    <span className="small mono muted">{shortHex(balance.token, 6, 4)}</span>
                  </dt>
                  <dd style={{ fontSize: '1.0625rem' }}>
                    <Amount atomic={balance.amountAtomic} token={balance.token} />
                  </dd>
                </div>
              ))}
              <div>
                <dt>Payment execution</dt>
                <dd>
                  {vault.executionPaused === null
                    ? 'Unknown'
                    : vault.executionPaused
                      ? 'Paused by owner'
                      : 'Running'}
                </dd>
              </div>
            </dl>
            <p className="small muted" style={{ marginTop: 10 }}>
              Mock demo tokens. No fiat value is implied.
            </p>
          </section>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Recent activity</h2>
          <button type="button" className="btn btn-quiet" onClick={() => onGo('activity')}>
            All activity
          </button>
        </div>
        <StaleNote refreshedAt={payments.refreshedAt} error={payments.error} />
        {payments.error && !payments.data && (
          <ErrorNotice error={payments.error} onRetry={() => void payments.refresh()} />
        )}
        <div className="log-head" aria-hidden="true">
          <span>When</span>
          <span>Merchant</span>
          <span>Amount</span>
          <span>Decision</span>
          <span>What happened</span>
        </div>
        <div className="log">
          {mine.slice(0, 5).map((record) => (
            <PaymentRow
              key={record.paymentId}
              record={record}
              label={labelFor(record.paymentId)}
              onOpen={onOpenPayment}
            />
          ))}
        </div>
        {mine.length === 0 && !payments.loading && !payments.error && (
          <p className="empty">No payments from this agent yet.</p>
        )}
      </section>
    </>
  );
}
