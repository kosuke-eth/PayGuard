import { useCallback, useEffect, useState } from 'react';
import { ReceiptDrawer } from './components/payments/ReceiptDrawer';
import { Entry } from './components/shell/Entry';
import { type PageKey, Shell } from './components/shell/Shell';
import { ErrorNotice } from './components/ui/ErrorNotice';
import { VaultDrawer } from './components/vault/VaultDrawer';
import { usePaymentNotifications } from './hooks/usePaymentNotifications';
import { usePayments } from './hooks/usePayments';
import { usePolling } from './hooks/usePolling';
import { useStoredRuns } from './hooks/useRunLabels';
import { useSystemStatus } from './hooks/useSystemStatus';
import { api } from './lib/payguard-client';
import { ActivityPage } from './pages/ActivityPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { DemoPage } from './pages/DemoPage';
import { OverviewPage } from './pages/OverviewPage';
import { PoliciesPage } from './pages/PoliciesPage';
import { SettingsPage } from './pages/SettingsPage';
import { useApp } from './state/app';
import { NamesProvider } from './state/names';
import { ToastProvider } from './state/toasts';

const PAGES: PageKey[] = ['overview', 'policies', 'approvals', 'activity', 'demo', 'settings'];
const TITLES: Record<PageKey, string> = {
  overview: 'Overview',
  policies: 'Policies',
  approvals: 'Approvals',
  activity: 'Activity',
  demo: 'Test payments',
  settings: 'Settings',
};

function pageFromHash(): PageKey | null {
  const key = window.location.hash.replace('#/', '') as PageKey;
  return PAGES.includes(key) ? key : null;
}

function Workspace() {
  const { profile, profiles, profilesError, refreshProfiles } = useApp();
  const [page, setPage] = useState<PageKey>(pageFromHash() ?? 'overview');
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [vaultOpen, setVaultOpen] = useState(false);
  const payments = usePayments();
  const pending = usePayments('AWAITING_APPROVAL');
  const { runs, save, labelFor } = useStoredRuns();
  const status = useSystemStatus();
  // Test payments are offered only where the backend actually exposes them.
  const testCatalog = usePolling(
    'test-payments-available',
    () => api.getDemoCatalog(),
    () => null,
  );
  const testPaymentsAvailable = testCatalog.data !== null;

  useEffect(() => {
    const onHash = () => {
      const next = pageFromHash();
      if (next) setPage(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = useCallback((next: PageKey) => {
    window.location.hash = `#/${next}`;
  }, []);

  // A newly settled payment changes on-chain counters and balances: re-read them right away.
  const settledCount =
    payments.data?.records.filter((r) => r.executionStatus === 'SUCCEEDED').length ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger on the count only
  useEffect(() => {
    if (settledCount > 0) void refreshProfiles();
  }, [settledCount]);

  const pendingCount = pending.data ? pending.data.records.length : null;

  useEffect(() => {
    document.title = `${pendingCount ? `(${pendingCount}) ` : ''}${TITLES[page]} · PayGuard`;
  }, [page, pendingCount]);
  usePaymentNotifications(payments.data?.records ?? null, labelFor, {
    review: () => navigate('approvals'),
    open: setReceiptId,
  });

  const refreshAll = useCallback(() => {
    void payments.refresh();
    void pending.refresh();
    void refreshProfiles();
  }, [payments, pending, refreshProfiles]);

  let body: React.ReactNode;
  if (page === 'settings') {
    body = <SettingsPage status={status} />;
  } else if (page === 'approvals') {
    body = (
      <ApprovalsPage
        pending={pending}
        labelFor={labelFor}
        onOpenPayment={setReceiptId}
        onChanged={refreshAll}
      />
    );
  } else if (!profile) {
    body = profilesError ? (
      <ErrorNotice error={profilesError} onRetry={() => void refreshProfiles()} />
    ) : profiles === null ? (
      <div className="stack">
        <div className="skeleton" style={{ height: 44, width: '50%' }} />
        <div className="skeleton" style={{ height: 120 }} />
        <div className="skeleton" style={{ height: 260 }} />
      </div>
    ) : (
      <div className="panel empty">
        This wallet owns no vault with an active policy on this deployment. Vaults are provisioned
        by the backend’s demo setup script for its owner account — sign in with that account, or run
        demo:setup.
      </div>
    );
  } else if (page === 'policies') {
    body = <PoliciesPage profile={profile} />;
  } else if (page === 'activity') {
    body = (
      <ActivityPage
        profile={profile}
        payments={payments}
        labelFor={labelFor}
        onOpenPayment={setReceiptId}
      />
    );
  } else if (page === 'demo') {
    body = (
      <DemoPage
        profile={profile}
        payments={payments}
        runs={runs}
        saveRuns={save}
        onOpenPayment={setReceiptId}
        onApprovals={() => navigate('approvals')}
      />
    );
  } else {
    body = (
      <OverviewPage
        profile={profile}
        payments={payments}
        pendingCount={pendingCount}
        labelFor={labelFor}
        onOpenPayment={setReceiptId}
        onOpenVault={() => setVaultOpen(true)}
        onGo={navigate}
      />
    );
  }

  return (
    <Shell
      page={page}
      onNavigate={navigate}
      pendingCount={pendingCount}
      testPaymentsAvailable={testPaymentsAvailable}
      status={status}
    >
      {body}
      {receiptId && <ReceiptDrawer paymentId={receiptId} onClose={() => setReceiptId(null)} />}
      {vaultOpen && profile && (
        <VaultDrawer profile={profile} onClose={() => setVaultOpen(false)} />
      )}
    </Shell>
  );
}

export function App() {
  const { boot, session } = useApp();
  const [route, setRoute] = useState<PageKey | null>(pageFromHash);
  useEffect(() => {
    const onHash = () => setRoute(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // The site root is the landing page. The vault opens only on an app route, after sign-in.
  if (route === null || boot.phase !== 'ready' || !session) return <Entry />;
  return (
    <ToastProvider>
      <NamesProvider>
        <Workspace />
      </NamesProvider>
    </ToastProvider>
  );
}
