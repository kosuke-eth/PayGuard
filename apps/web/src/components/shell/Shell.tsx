import type { ReactNode } from 'react';
import type { Polled } from '../../hooks/usePolling';
import type { Readiness } from '../../hooks/useSystemStatus';
import { findRoute, isKnownRouteKind, routeLabel, shortHex } from '../../lib/labels';
import { useApp, useConfig } from '../../state/app';
import { useNames } from '../../state/names';

export type PageKey = 'overview' | 'policies' | 'approvals' | 'activity' | 'demo' | 'settings';

export function BrandMark({ inverse = false }: { inverse?: boolean }) {
  const plate = inverse ? '#16235c' : '#fff';
  const stroke = inverse ? '#fff' : '#16235c';
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill={plate} />
      <path
        d="M16 6.4 24.2 9.1v6.5c0 4.6-3.2 8.3-8.2 10-5-1.7-8.2-5.4-8.2-10V9.1Z"
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M11.2 13.4h4.2" stroke="#bd2c1e" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M11.2 16.4h10" stroke="#0b7f5a" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M11.2 19.4h7" stroke="#a85f00" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function NavIcon({ page }: { page: PageKey }) {
  const props = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (page === 'overview') {
    return (
      <svg {...props} aria-hidden="true">
        <rect x="2" y="2" width="5" height="5" rx="1" />
        <rect x="9" y="2" width="5" height="5" rx="1" />
        <rect x="2" y="9" width="5" height="5" rx="1" />
        <rect x="9" y="9" width="5" height="5" rx="1" />
      </svg>
    );
  }
  if (page === 'policies') {
    return (
      <svg {...props} aria-hidden="true">
        <path d="M8 1.8 13.2 3.6v4.2c0 3-2 5.3-5.2 6.4C4.8 13.1 2.8 10.8 2.8 7.8V3.6Z" />
        <path d="M5.6 8.1 7.2 9.7 10.6 6.3" />
      </svg>
    );
  }
  if (page === 'approvals') {
    return (
      <svg {...props} aria-hidden="true">
        <path d="M3 4.5h10" />
        <path d="M3 8h10" />
        <path d="M3 11.5h6" />
      </svg>
    );
  }
  if (page === 'activity') {
    return (
      <svg {...props} aria-hidden="true">
        <path d="M2.5 12.5 6 8.2l2.4 2.2L13.5 4" />
      </svg>
    );
  }
  if (page === 'demo') {
    return (
      <svg {...props} aria-hidden="true">
        <path d="M5 3.5v9l7-4.5Z" />
      </svg>
    );
  }
  return (
    <svg {...props} aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 2.2v1.4M8 12.4v1.4M2.2 8h1.4M12.4 8h1.4M3.8 3.8l1 1M11.2 11.2l1 1M12.2 3.8l-1 1M4.8 11.2l-1 1" />
    </svg>
  );
}

export function Shell({
  page,
  onNavigate,
  pendingCount,
  testPaymentsAvailable,
  status,
  children,
}: {
  page: PageKey;
  onNavigate: (page: PageKey) => void;
  pendingCount: number | null;
  testPaymentsAvailable: boolean;
  status: Polled<Readiness>;
  children: ReactNode;
}) {
  const config = useConfig();
  const { nameOf } = useNames();
  const {
    session,
    account,
    accountMismatch,
    wrongNetwork,
    fixNetwork,
    connect,
    signOut,
    profiles,
    profile,
    selectProfile,
  } = useApp();
  const unknownKinds = config.routes
    .filter((route) => !isKnownRouteKind(route.kind))
    .map((route) => route.kind);

  const nav: Array<{ key: PageKey; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'policies', label: 'Policies' },
    { key: 'approvals', label: 'Approvals' },
    { key: 'activity', label: 'Activity' },
    ...(testPaymentsAvailable ? [{ key: 'demo' as const, label: 'Test payments' }] : []),
  ];

  const health = status.data;
  const failing = health?.checks.filter((check) => !check.ok) ?? [];
  const statusTone = status.error && !health ? 'unknown' : failing.length === 0 ? 'ok' : 'down';
  const statusText =
    statusTone === 'ok'
      ? 'All systems operational'
      : statusTone === 'down'
        ? 'Service degraded'
        : 'Status unavailable';

  return (
    <>
      {config.environment !== undefined && (
        <div className="testbar">
          <strong>{config.environment === 'LOCAL_DEMO' ? 'Test environment' : 'Testnet'}</strong>
          <span>
            {config.environment === 'LOCAL_DEMO' ? 'Local chain' : 'Chain'} {config.chainId} · mock
            assets · no real funds move
          </span>
        </div>
      )}
      <div className="shell">
        <aside className="side">
          <div className="brand-lockup">
            <div className="brand">
              <BrandMark />
              PayGuard
            </div>
            <p className="brand-tag">Spending firewall</p>
          </div>
          <nav className="nav" aria-label="Main">
            {nav.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-current={page === item.key ? 'page' : undefined}
                onClick={() => onNavigate(item.key)}
              >
                <NavIcon page={item.key} />
                <span className="nav-label">{item.label}</span>
                {item.key === 'approvals' && !!pendingCount && (
                  <span className="nav-count">{pendingCount}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="side-foot">
            <nav className="nav" aria-label="Account">
              <button
                type="button"
                aria-current={page === 'settings' ? 'page' : undefined}
                onClick={() => onNavigate('settings')}
              >
                <NavIcon page="settings" />
                <span className="nav-label">Settings</span>
              </button>
            </nav>
            <button type="button" className="status-pill" onClick={() => onNavigate('settings')}>
              <i className={`status-dot status-${statusTone}`} />
              {statusText}
            </button>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <div className="row">
              <label htmlFor="profile-select" className="muted small">
                Agent
              </label>
              <select
                id="profile-select"
                className="select profile-select"
                value={profile?.id ?? ''}
                disabled={!profiles || profiles.length === 0}
                onChange={(event) => selectProfile(event.target.value)}
              >
                {(profiles ?? []).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {nameOf(candidate.policy.config.agent) ??
                      `Agent ${shortHex(candidate.policy.config.agent, 6, 4)}`}{' '}
                    · {routeLabel(findRoute(config, candidate.policy.config.routeId)?.kind)}
                  </option>
                ))}
              </select>
            </div>
            <div className="topbar-right">
              <button type="button" className="account" onClick={() => onNavigate('settings')}>
                <span className="avatar" aria-hidden="true">
                  {(session?.walletAddress ?? '0x??').slice(2, 4).toUpperCase()}
                </span>
                <span className="mono small">{shortHex(session?.walletAddress)}</span>
              </button>
              <button type="button" className="btn" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </header>

          {statusTone === 'down' && (
            <div className="banner" role="status">
              <span>
                {failing.some((check) => check.name === 'worker')
                  ? 'The relayer is offline. Decisions still work, but approved payments will wait in the queue until it is back.'
                  : 'Part of PayGuard is not ready. Some figures may be unavailable.'}
              </span>
              <button type="button" className="btn" onClick={() => onNavigate('settings')}>
                View status
              </button>
            </div>
          )}
          {wrongNetwork && (
            <div className="banner" role="alert">
              <span>
                Your wallet is on a different network. Actions are disabled until it is on chain{' '}
                {config.chainId}.
              </span>
              <button type="button" className="btn" onClick={() => void fixNetwork()}>
                Switch network
              </button>
            </div>
          )}
          {accountMismatch && (
            <div className="banner" role="alert">
              <span>
                Your wallet changed to {shortHex(account)}, but you are signed in as{' '}
                {shortHex(session?.walletAddress)}. Review anything again before signing. Actions
                are disabled.
              </span>
              <button type="button" className="btn" onClick={() => void signOut().then(connect)}>
                Sign in as {shortHex(account)}
              </button>
            </div>
          )}
          {!account && (
            <div className="banner" role="alert">
              <span>No wallet account is connected to this page. You can read, but not sign.</span>
              <button type="button" className="btn" onClick={() => void connect()}>
                Reconnect wallet
              </button>
            </div>
          )}
          {unknownKinds.length > 0 && (
            <div className="banner" role="alert">
              <span>
                The backend advertises a settlement route this version does not recognise (
                <span className="mono">{unknownKinds.join(', ')}</span>). It is shown as-is until
                the deployment record is corrected.
              </span>
            </div>
          )}

          <main className="content" key={page}>
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
