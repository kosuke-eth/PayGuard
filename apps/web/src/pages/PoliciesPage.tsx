import { useState } from 'react';
import { BudgetMeter } from '../components/policy/BudgetMeter';
import { ReplacePolicyForm } from '../components/policy/ReplacePolicyForm';
import { Amount, Hex, TokenName } from '../components/ui/Amount';
import { Drawer } from '../components/ui/Drawer';
import { ErrorNotice } from '../components/ui/ErrorNotice';
import { Party } from '../components/ui/Party';
import { OwnerTxFlow } from '../components/vault/OwnerTxFlow';
import { toUiError, type UiError } from '../lib/errors';
import { categoriesFromBitmap, findRoute, formatUnixSeconds, routeLabel } from '../lib/labels';
import { api } from '../lib/payguard-client';
import type { PreparedPolicyTransaction, Profile } from '../lib/types';
import { useApp, useConfig } from '../state/app';

export function PoliciesPage({ profile }: { profile: Profile }) {
  const config = useConfig();
  const { canAct, refreshProfiles, handleApiError } = useApp();
  const { policy, vault } = profile;
  const c = policy.config;
  const route = findRoute(config, c.routeId);
  const [replacing, setReplacing] = useState(false);
  const [revocation, setRevocation] = useState<PreparedPolicyTransaction | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepareRevoke() {
    setBusy(true);
    setError(null);
    try {
      setRevocation(await api.prepareRevocation(policy.policyId));
    } catch (caught) {
      setError(toUiError(caught));
      handleApiError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Policy</h1>
          <p>
            The rules the vault enforces for this agent. They live on-chain; this page reads them
            back.
          </p>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canAct}
            onClick={() => setReplacing(true)}
          >
            Replace policy
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={!canAct || busy}
            onClick={() => void prepareRevoke()}
          >
            Revoke policy
          </button>
        </div>
      </div>
      {error && <ErrorNotice error={error} />}

      <div className="grid-2">
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h2>Limits</h2>
            <span className={`tag ${policy.status === 'ACTIVE' ? '' : 'tag-warn'}`}>
              {policy.status}
            </span>
          </div>
          <BudgetMeter policy={policy} />
          <dl className="ledger">
            <div>
              <dt>Agent</dt>
              <dd>
                <Party address={c.agent} kind="agent" />
              </dd>
            </div>
            <div>
              <dt>Total budget</dt>
              <dd>
                <Amount atomic={c.totalOutputBudget} token={c.settlementToken} />
              </dd>
            </div>
            <div>
              <dt>Budget per period</dt>
              <dd>
                <Amount atomic={c.epochOutputBudget} token={c.settlementToken} />
              </dd>
            </div>
            <div>
              <dt>Automatic payment limit</dt>
              <dd>
                <Amount atomic={c.automaticOutputCap} token={c.settlementToken} />
              </dd>
            </div>
            <div>
              <dt>Human approval up to</dt>
              <dd>
                <Amount atomic={c.escalationOutputCap} token={c.settlementToken} />
              </dd>
            </div>
            <div>
              <dt>Input asset</dt>
              <dd>
                <TokenName address={c.inputToken} />
              </dd>
            </div>
            <div>
              <dt>Settlement asset</dt>
              <dd>
                <TokenName address={c.settlementToken} />
              </dd>
            </div>
            <div>
              <dt>Settlement route</dt>
              <dd>{routeLabel(route?.kind)}</dd>
            </div>
            <div>
              <dt>Valid until</dt>
              <dd>{formatUnixSeconds(c.validUntil)}</dd>
            </div>
          </dl>
        </section>

        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Allowed merchants</h2>
            </div>
            {policy.merchants.length === 0 && (
              <p className="muted">None. Every invoice will be blocked.</p>
            )}
            <dl className="ledger">
              {policy.merchants.map((merchant) => (
                <div key={merchant.merchantId}>
                  <dt>
                    <Party address={merchant.recipient} kind="merchant" />
                    <div className="small">category {merchant.category}</div>
                  </dt>
                  <dd className="small">
                    invoices signed by <Hex value={merchant.invoiceSigner} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Allowed categories</h2>
            </div>
            <div className="row">
              {categoriesFromBitmap(c.allowedCategoryBitmap).map((category) => (
                <span className="tag" key={category}>
                  Category {category}
                </span>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>
              The backend publishes category numbers, not names, so numbers are shown as they are.
            </p>
          </section>
        </div>
      </div>

      <details className="tech">
        <summary>Advanced</summary>
        <div>
          <dl className="ledger small">
            <div>
              <dt>On-chain policy ID</dt>
              <dd>
                <Hex value={policy.onchainPolicyId} />
              </dd>
            </div>
            <div>
              <dt>Policy resource</dt>
              <dd>
                <Hex value={policy.policyId} />
              </dd>
            </div>
            <div>
              <dt>Vault</dt>
              <dd>
                <Hex value={vault.address} />
              </dd>
            </div>
            <div>
              <dt>Source asset budget</dt>
              <dd>
                <Amount atomic={c.totalInputBudget} token={c.inputToken} precise />
              </dd>
            </div>
            <div>
              <dt>Source asset spent</dt>
              <dd>
                {policy.counters ? (
                  <Amount
                    atomic={String(policy.counters.inputSpent)}
                    token={c.inputToken}
                    precise
                  />
                ) : (
                  'unknown'
                )}
              </dd>
            </div>
            <div>
              <dt>Maximum source asset per payment</dt>
              <dd>
                <Amount atomic={c.maxInputPerPayment} token={c.inputToken} precise />
              </dd>
            </div>
            <div>
              <dt>Route ID</dt>
              <dd>
                <Hex value={c.routeId} />
              </dd>
            </div>
            <div>
              <dt>Adapter</dt>
              <dd>
                <Hex value={c.adapter} />
              </dd>
            </div>
            <div>
              <dt>Subsidy mode</dt>
              <dd className="mono">{c.subsidyMode}</dd>
            </div>
            <div>
              <dt>Valid from</dt>
              <dd>{formatUnixSeconds(c.validAfter)}</dd>
            </div>
            <div>
              <dt>Read at block</dt>
              <dd className="mono">{policy.observation?.blockNumber ?? 'not observed'}</dd>
            </div>
          </dl>
        </div>
      </details>

      {replacing && <ReplacePolicyForm profile={profile} onClose={() => setReplacing(false)} />}
      {revocation && (
        <Drawer title="Revoke policy" onClose={() => setRevocation(null)}>
          <p className="muted">
            Revocation removes this agent’s authority under the policy. It is effective only after
            the transaction executes on-chain and PayGuard observes it.
          </p>
          <OwnerTxFlow
            transactions={[revocation.transaction]}
            vaultAddress={vault.address}
            relatedResourceId={policy.policyId}
            completionNote="Waiting for PayGuard to observe the revocation. The policy status updates when it does."
            onFinished={() => void refreshProfiles()}
          />
        </Drawer>
      )}
    </>
  );
}
