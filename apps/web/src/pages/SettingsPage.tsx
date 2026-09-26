import { Hex } from '../components/ui/Amount';
import { ErrorNotice } from '../components/ui/ErrorNotice';
import { Party } from '../components/ui/Party';
import type { Polled } from '../hooks/usePolling';
import { describeCheck, type Readiness } from '../hooks/useSystemStatus';
import { findRoute, formatTime, routeLabel } from '../lib/labels';
import { useApp, useConfig } from '../state/app';
import { useNames } from '../state/names';

export function SettingsPage({ status }: { status: Polled<Readiness> }) {
  const config = useConfig();
  const { session, account, signOut, profiles } = useApp();
  const { names, rename } = useNames();

  const agents = new Map<string, string[]>();
  const merchants = new Set<string>();
  for (const profile of profiles ?? []) {
    agents.set(profile.policy.config.agent, [
      ...(agents.get(profile.policy.config.agent) ?? []),
      routeLabel(findRoute(config, profile.policy.config.routeId)?.kind),
    ]);
    for (const merchant of profile.policy.merchants) merchants.add(merchant.recipient);
  }
  const known = new Set([...agents.keys(), ...merchants].map((address) => address.toLowerCase()));
  const others = Object.keys(names).filter((address) => !known.has(address));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>
            Your account, the names you use for agents and merchants, and the health of the service.
          </p>
        </div>
      </div>

      <div className="grid-2">
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Account</h2>
            </div>
            <dl className="ledger">
              <div>
                <dt>Signed in as</dt>
                <dd>
                  <Hex value={session?.walletAddress} />
                </dd>
              </div>
              <div>
                <dt>Wallet account</dt>
                <dd>{account ? <Hex value={account} /> : 'Not connected'}</dd>
              </div>
              <div>
                <dt>Session ends</dt>
                <dd>{session ? formatTime(session.sessionExpiresAt) : '—'}</dd>
              </div>
            </dl>
            <p className="small muted" style={{ margin: '10px 0' }}>
              Signing out ends this browser session only. An agent keeps its authority until you
              revoke it on-chain from Vault controls or Policies.
            </p>
            <button type="button" className="btn" onClick={() => void signOut()}>
              Sign out
            </button>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Names</h2>
            </div>
            <p className="small muted" style={{ marginBottom: 12 }}>
              PayGuard knows agents and merchants by address. Names are your own labels, saved in
              this browser, and never sent anywhere or used in a decision.
            </p>
            <h3 style={{ marginBottom: 6 }}>Agents</h3>
            <div className="stack" style={{ gap: 8, marginBottom: 16 }}>
              {[...agents].map(([address, routes]) => (
                <div className="spread" key={address}>
                  <Party address={address} kind="agent" />
                  <span className="small muted">{routes.join(' · ')}</span>
                </div>
              ))}
              {agents.size === 0 && <span className="muted small">No agents yet.</span>}
            </div>
            <h3 style={{ marginBottom: 6 }}>Merchants on your policies</h3>
            <div className="stack" style={{ gap: 8 }}>
              {[...merchants].map((address) => (
                <Party key={address} address={address} kind="merchant" />
              ))}
              {merchants.size === 0 && <span className="muted small">No merchants yet.</span>}
            </div>
            {others.length > 0 && (
              <>
                <h3 style={{ margin: '16px 0 6px' }}>Other saved names</h3>
                <div className="stack" style={{ gap: 8 }}>
                  {others.map((address) => (
                    <div className="spread" key={address}>
                      <Party address={address} kind="merchant" />
                      <button
                        type="button"
                        className="btn btn-quiet"
                        onClick={() => rename(address, '')}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>System status</h2>
              {status.refreshedAt && (
                <span className="small muted">
                  checked {new Date(status.refreshedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
            {status.error && !status.data && (
              <ErrorNotice error={status.error} onRetry={() => void status.refresh()} />
            )}
            <dl className="ledger">
              {status.data?.checks.map((check) => {
                const { label, text } = describeCheck(check);
                return (
                  <div key={check.name}>
                    <dt>
                      <i className={`status-dot status-${check.ok ? 'ok' : 'down'}`} /> {label}
                    </dt>
                    <dd
                      className={check.ok ? 'muted' : ''}
                      style={{ fontWeight: check.ok ? 400 : 600, maxWidth: '26ch' }}
                    >
                      {text}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Network</h2>
            </div>
            <dl className="ledger">
              <div>
                <dt>Environment</dt>
                <dd>{config.environment === 'LOCAL_DEMO' ? 'Test (local chain)' : 'Testnet'}</dd>
              </div>
              <div>
                <dt>Chain ID</dt>
                <dd className="mono">{config.chainId}</dd>
              </div>
              <div>
                <dt>Deployment</dt>
                <dd>
                  <Hex value={config.deploymentId} />
                </dd>
              </div>
              <div>
                <dt>Settlement finality</dt>
                <dd className="mono">{config.confidencePolicy.mode}</dd>
              </div>
              <div>
                <dt>Routes</dt>
                <dd>{config.routes.map((route) => routeLabel(route.kind)).join(', ')}</dd>
              </div>
              <div>
                <dt>Assets</dt>
                <dd>{[...new Set(config.tokens.map((token) => token.symbol))].join(', ')}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </>
  );
}
