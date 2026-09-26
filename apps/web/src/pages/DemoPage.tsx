import { useEffect, useRef, useState } from 'react';
import { ApprovalCard } from '../components/approvals/ApprovalCard';
import { RunPipeline } from '../components/demo/RunPipeline';
import { VerdictGate } from '../components/payments/VerdictGate';
import { Amount } from '../components/ui/Amount';
import { ErrorNotice } from '../components/ui/ErrorNotice';
import type { Polled } from '../hooks/usePolling';
import { usePolling } from '../hooks/usePolling';
import { toUiError, type UiError } from '../lib/errors';
import {
  catalogAmountForDecimals,
  findRoute,
  findToken,
  formatTime,
  isInFlight,
  needsOwnerApproval,
  routeLabel,
} from '../lib/labels';
import { api, newIdempotencyKey, PayGuardApiError } from '../lib/payguard-client';
import type { PaymentPage } from '../lib/payments';
import type { StoredRun } from '../lib/storage';
import type { DemoRun, DemoScenario, PaymentDetail, Profile } from '../lib/types';
import { useApp, useConfig } from '../state/app';

interface RunView {
  run: DemoRun;
  payment: PaymentDetail | null;
}

async function loadRun(runId: string): Promise<RunView> {
  const run = await api.getDemoRun(runId);
  const payment = run.paymentId ? await api.getPayment(run.paymentId) : null;
  return { run, payment };
}

function runIsLive(view: RunView | null): boolean {
  if (!view) return true;
  if (
    ['REJECTED_INVALID_SIGNATURE', 'BLOCKED', 'DUPLICATE_NOT_PAID_TWICE'].includes(
      view.run.orchestrationStatus,
    )
  )
    return false;
  if (!view.payment) return true;
  return (
    needsOwnerApproval(
      view.payment.policyDecision,
      view.payment.executionStatus,
      view.payment.reasonCode,
    ) || isInFlight(view.payment.executionStatus, view.payment.policyDecision)
  );
}

export function DemoPage({
  profile,
  payments,
  runs,
  saveRuns,
  onOpenPayment,
  onApprovals,
}: {
  profile: Profile;
  payments: Polled<PaymentPage>;
  runs: StoredRun[];
  saveRuns: (update: (previous: StoredRun[]) => StoredRun[]) => void;
  onOpenPayment: (paymentId: string) => void;
  onApprovals: () => void;
}) {
  const config = useConfig();
  const { canAct, handleApiError } = useApp();
  const catalog = usePolling(
    'demo-catalog',
    () => api.getDemoCatalog(),
    () => 15000,
    handleApiError,
  );
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  // A start whose response was lost is retried with the SAME key and body, so it recovers the same run.
  const pending = useRef<{
    key: string;
    scenario: DemoScenario;
    body: { profileId: string; scenarioId: string; sourcePaymentId?: string };
  } | null>(null);

  const profileRuns = runs.filter((run) => run.profileId === profile.id);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-evaluate when the profile or stored runs change
  useEffect(() => {
    setActiveRunId((current) =>
      current && profileRuns.some((run) => run.runId === current)
        ? current
        : (profileRuns[0]?.runId ?? null),
    );
  }, [profile.id, runs.length]);

  const active = usePolling(
    activeRunId ? `run:${activeRunId}` : null,
    () => loadRun(activeRunId as string),
    (view) => (runIsLive(view) ? 2000 : null),
    handleApiError,
  );

  // Once the backend reports the run's payment, remember the id so Activity can show its name.
  const observedPaymentId =
    active.data?.run.runId === activeRunId ? (active.data?.run.paymentId ?? null) : null;
  useEffect(() => {
    if (!activeRunId || !observedPaymentId) return;
    saveRuns((previous) =>
      previous.map((run) =>
        run.runId === activeRunId && !run.paymentId
          ? { ...run, paymentId: observedPaymentId }
          : run,
      ),
    );
  }, [activeRunId, observedPaymentId, saveRuns]);

  const demoProfile = catalog.data?.profiles.find(
    (candidate) => candidate.profileId === profile.id,
  );
  const route = findRoute(config, profile.policy.config.routeId);
  const settlementDecimals =
    findToken(config, profile.policy.config.settlementToken)?.decimals ?? 6;
  const sourcePayment = payments.data?.records.find(
    (record) => record.vaultId === profile.vault.vaultId && record.executionStatus === 'SUCCEEDED',
  );

  async function start(scenario: DemoScenario, retry = false) {
    setError(null);
    setStarting(scenario.scenarioId);
    if (!retry || !pending.current) {
      pending.current = {
        key: newIdempotencyKey(),
        scenario,
        body: {
          profileId: profile.id,
          scenarioId: scenario.scenarioId,
          ...(scenario.requiresSourcePayment && sourcePayment
            ? { sourcePaymentId: sourcePayment.paymentId }
            : {}),
        },
      };
    }
    const attempt = pending.current;
    try {
      const run = await api.startDemoRun(attempt.body, attempt.key);
      pending.current = null;
      saveRuns((previous) => [
        {
          runId: run.runId,
          scenarioId: scenario.scenarioId,
          scenarioLabel: scenario.label,
          profileId: profile.id,
          startedAt: new Date().toISOString(),
          paymentId: run.paymentId,
        },
        ...previous.filter((entry) => entry.runId !== run.runId),
      ]);
      setActiveRunId(run.runId);
      void payments.refresh();
    } catch (caught) {
      if (caught instanceof PayGuardApiError) pending.current = null;
      setError(toUiError(caught));
      handleApiError(caught);
    } finally {
      setStarting(null);
    }
  }

  const demoOff = catalog.error?.code === 'RESOURCE_NOT_FOUND';
  const view = active.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Test payments</h1>
          <p>
            Send a scripted payment through the real system to see how your policy responds. A
            seeded test merchant signs the invoice and a seeded test agent signs the intent; from
            there it is the same API, relayer and vault as any payment. These are fixed scenarios,
            not live AI reasoning, and this page never decides an outcome.
          </p>
        </div>
        <span className="tag">Settles via {routeLabel(route?.kind)}</span>
      </div>

      {demoOff && (
        <div className="notice notice-NETWORK">
          <div className="notice-title">Test payments are not available</div>
          This environment does not offer scripted test payments. Payments from your real agents
          still appear in Activity.
        </div>
      )}
      {catalog.error && !demoOff && !catalog.data && (
        <ErrorNotice error={catalog.error} onRetry={() => void catalog.refresh()} />
      )}
      {demoProfile && !demoProfile.available && (
        <div className="notice notice-WALLET">
          The backend reports this agent’s policy as unavailable: its route is not enabled or its
          policy is not active. Pick another agent in the top bar.
        </div>
      )}

      <div className="grid-2 demo-split">
        <section className="stack">
          {catalog.data?.scenarios.map((scenario) => {
            const permitted =
              scenario.permittedProfileIds.includes(profile.id) && demoProfile?.available === true;
            const needsSource = scenario.requiresSourcePayment && !sourcePayment;
            const disabled = !permitted || needsSource || !canAct || starting !== null;
            return (
              <button
                key={scenario.scenarioId}
                type="button"
                className="scenario"
                aria-disabled={disabled}
                onClick={() => !disabled && void start(scenario)}
              >
                <span className="spread">
                  <strong>
                    {starting === scenario.scenarioId ? 'Starting…' : `Run ${scenario.label}`}
                  </strong>
                  {!scenario.requiresSourcePayment && (
                    <span className="num">
                      <Amount
                        atomic={catalogAmountForDecimals(
                          scenario.invoiceAmountAtomic,
                          settlementDecimals,
                        )}
                        token={profile.policy.config.settlementToken}
                      />
                    </span>
                  )}
                </span>
                <span className="small muted">{scenario.description}</span>
                {!permitted && (
                  <span className="small" style={{ color: 'var(--escalate)' }}>
                    Not offered for this agent by the backend.
                  </span>
                )}
                {permitted && needsSource && (
                  <span className="small" style={{ color: 'var(--escalate)' }}>
                    Needs a settled payment from this agent first.
                  </span>
                )}
              </button>
            );
          })}
          {error && (
            <>
              <ErrorNotice error={error} />
              {pending.current && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => pending.current && void start(pending.current.scenario, true)}
                >
                  Retry the same request
                </button>
              )}
            </>
          )}
        </section>

        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h2>
              {profileRuns.find((run) => run.runId === activeRunId)?.scenarioLabel ??
                'No run selected'}
            </h2>
            {view?.run.paymentId && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => onOpenPayment(view.run.paymentId as string)}
              >
                Open receipt
              </button>
            )}
          </div>
          <VerdictGate
            decision={
              view?.payment?.policyDecision ??
              (view?.run.orchestrationStatus === 'BLOCKED' ? 'BLOCK' : null)
            }
            status={view?.payment?.executionStatus ?? null}
          />
          {!activeRunId && (
            <p className="muted">Run a scenario to watch it pass through the gate.</p>
          )}
          {active.error && !view && (
            <ErrorNotice error={active.error} onRetry={() => void active.refresh()} />
          )}
          {view && <RunPipeline run={view.run} payment={view.payment} onApprovals={onApprovals} />}
        </section>
      </div>

      {view?.payment &&
        needsOwnerApproval(
          view.payment.policyDecision,
          view.payment.executionStatus,
          view.payment.reasonCode,
        ) && (
          <ApprovalCard
            payment={{
              ...view.payment,
              createdAt: view.payment.observedAt?.observedAt ?? new Date().toISOString(),
            }}
            profile={profile}
            label={profileRuns.find((run) => run.runId === activeRunId)?.scenarioLabel ?? null}
            onOpenPayment={onOpenPayment}
            onChanged={() => {
              void payments.refresh();
              void active.refresh();
            }}
          />
        )}

      {profileRuns.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Runs started from this browser</h2>
          </div>
          <div className="log">
            {profileRuns.map((run) => (
              <button
                key={run.runId}
                type="button"
                className="log-row run-row"
                onClick={() => setActiveRunId(run.runId)}
              >
                <span className="small muted num">{formatTime(run.startedAt)}</span>
                <span>{run.scenarioLabel}</span>
                <span className="small muted">
                  {run.runId === activeRunId ? 'shown above' : 'show'}
                </span>
              </button>
            ))}
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            Only run ids are kept in this browser. Their state is always re-read from the backend.
          </p>
        </section>
      )}
    </>
  );
}
