import type { PublicConfig } from '@payguard/integration';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { isInvalidSession, toUiError, type UiError } from '../lib/errors';
import { api, setCsrfToken } from '../lib/payguard-client';
import { storage } from '../lib/storage';
import type { Profile, SessionInfo } from '../lib/types';
import {
  getProvider,
  onWalletChange,
  readAccounts,
  readChainId,
  requestAccounts,
  signMessage,
  switchChain,
} from '../lib/wallet';

type Boot =
  | { phase: 'loading' }
  | { phase: 'failed'; error: UiError; problems: string[] }
  | { phase: 'ready'; config: PublicConfig };

interface AppState {
  boot: Boot;
  retryBoot: () => void;
  walletAvailable: boolean;
  account: string | null;
  walletChainId: string | null;
  session: SessionInfo | null;
  sessionChecked: boolean;
  connecting: boolean;
  connectError: UiError | null;
  connect: () => Promise<void>;
  signOut: () => Promise<void>;
  fixNetwork: () => Promise<void>;
  /** Wallet account differs from the signed-in owner: reads stay visible, actions are disabled. */
  accountMismatch: boolean;
  wrongNetwork: boolean;
  canAct: boolean;
  profiles: Profile[] | null;
  profilesError: UiError | null;
  profilesRefreshedAt: number | null;
  refreshProfiles: () => Promise<void>;
  profile: Profile | null;
  selectProfile: (id: string) => void;
  handleApiError: (error: unknown) => void;
}

const Context = createContext<AppState | null>(null);

/** Schema/version gate for /v1/config. A surprise here stops the app instead of guessing. */
function checkConfig(config: PublicConfig): string[] {
  const problems: string[] = [];
  if (config.schemaVersion !== '1')
    problems.push(`schemaVersion is ${config.schemaVersion}, expected 1`);
  if (config.abiSchemaVersion !== '1') {
    problems.push(`abiSchemaVersion is ${config.abiSchemaVersion}, expected 1`);
  }
  if (!/^(0|[1-9][0-9]*)$/.test(config.chainId ?? ''))
    problems.push('chainId is not a decimal string');
  if (!config.deploymentId) problems.push('deploymentId is missing');
  if (!Array.isArray(config.tokens) || !Array.isArray(config.routes)) {
    problems.push('tokens/routes are missing');
  }
  return problems;
}

async function loadProfiles(): Promise<Profile[]> {
  const vaults = await api.listVaults();
  const details = await Promise.all(vaults.items.map((vault) => api.getVault(vault.vaultId)));
  const nested = await Promise.all(
    details.map(async (vault) =>
      Promise.all(
        vault.activePolicies.map(async (entry) => ({
          id: entry.policyResourceId,
          vault,
          policy: await api.getPolicy(entry.policyResourceId),
        })),
      ),
    ),
  );
  return nested.flat();
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });
  const [bootAttempt, setBootAttempt] = useState(0);
  const [account, setAccount] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<UiError | null>(null);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [profilesError, setProfilesError] = useState<UiError | null>(null);
  const [profilesRefreshedAt, setProfilesRefreshedAt] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const config = boot.phase === 'ready' ? boot.config : null;

  // 1. runtime configuration
  // biome-ignore lint/correctness/useExhaustiveDependencies: bootAttempt is the retry trigger
  useEffect(() => {
    let cancelled = false;
    setBoot({ phase: 'loading' });
    api
      .getConfig()
      .then((loaded) => {
        if (cancelled) return;
        const problems = checkConfig(loaded);
        if (problems.length > 0) {
          setBoot({
            phase: 'failed',
            problems,
            error: {
              kind: 'NETWORK',
              title: 'Configuration',
              text: 'The backend’s /v1/config does not match what this frontend was built against.',
              retryable: false,
            },
          });
          return;
        }
        setBoot({ phase: 'ready', config: loaded });
      })
      .catch((error) => {
        if (!cancelled) setBoot({ phase: 'failed', error: toUiError(error), problems: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [bootAttempt]);

  // 2. wallet observation
  const syncWallet = useCallback(async () => {
    const [first] = await readAccounts();
    setAccount(first ?? null);
    setWalletChainId(await readChainId());
  }, []);

  useEffect(() => {
    void syncWallet();
    return onWalletChange(() => void syncWallet());
  }, [syncWallet]);

  // 3. session recovery (cookie survives a reload; the CSRF token is rotated and re-issued)
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    api
      .recoverSession()
      .then((recovered) => {
        if (cancelled) return;
        setCsrfToken(recovered.csrfToken);
        setSession(recovered);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      })
      .finally(() => {
        if (!cancelled) setSessionChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  const dropSession = useCallback(() => {
    setCsrfToken(null);
    setSession(null);
    setProfiles(null);
  }, []);

  // A session that reaches its expiry is dropped here rather than discovered through a failed click.
  const expiresAt = session?.sessionExpiresAt ?? null;
  useEffect(() => {
    if (!expiresAt) return;
    const wait = new Date(expiresAt).getTime() - Date.now();
    const timer = setTimeout(
      () => {
        dropSession();
        setConnectError({
          kind: 'SESSION',
          title: 'Session',
          text: 'Your session expired. Sign in with your wallet again to continue.',
          retryable: false,
        });
      },
      Math.min(Math.max(wait, 0), 2 ** 31 - 1),
    );
    return () => clearTimeout(timer);
  }, [expiresAt, dropSession]);

  const handleApiError = useCallback(
    (error: unknown) => {
      if (isInvalidSession(error)) dropSession();
    },
    [dropSession],
  );

  const connect = useCallback(async () => {
    if (!config) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const [selected] = await requestAccounts();
      if (!selected) throw new Error('The wallet returned no account.');
      if ((await readChainId()) !== config.chainId) await switchChain(config.chainId);
      await syncWallet();
      const challenge = await api.createChallenge(selected, config.chainId);
      const signature = await signMessage(selected, challenge.message);
      const verified = await api.verifyChallenge(challenge.challengeId, signature);
      setCsrfToken(verified.csrfToken);
      setSession(verified);
    } catch (error) {
      setConnectError(toUiError(error));
    } finally {
      setConnecting(false);
    }
  }, [config, syncWallet]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // the local session is dropped either way
    }
    dropSession();
  }, [dropSession]);

  const fixNetwork = useCallback(async () => {
    if (!config) return;
    try {
      await switchChain(config.chainId);
      await syncWallet();
    } catch (error) {
      setConnectError(toUiError(error));
    }
  }, [config, syncWallet]);

  // 4. owner resources
  const owner = session?.walletAddress ?? null;
  const loadGeneration = useRef(0);
  const refreshProfiles = useCallback(async () => {
    if (!owner) return;
    const mine = ++loadGeneration.current;
    try {
      const loaded = await loadProfiles();
      if (mine !== loadGeneration.current) return;
      setProfiles(loaded);
      setProfilesError(null);
      setProfilesRefreshedAt(Date.now());
    } catch (error) {
      if (mine !== loadGeneration.current) return;
      setProfilesError(toUiError(error));
      handleApiError(error);
    }
  }, [owner, handleApiError]);

  useEffect(() => {
    if (!owner || !config) return;
    setSelectedId(storage.getSelectedProfile(config.deploymentId, owner));
    void refreshProfiles();
    const timer = setInterval(() => void refreshProfiles(), 12000);
    return () => clearInterval(timer);
  }, [owner, config, refreshProfiles]);

  const profile = useMemo(() => {
    if (!profiles || profiles.length === 0) return null;
    const selected = profiles.find((candidate) => candidate.id === selectedId);
    if (selected && selected.policy.status === 'ACTIVE') return selected;
    // After replace, the stored id is the superseded snapshot. Follow the live policy
    // for the same vault and agent instead of leaving Policies stuck on SUPERSEDED.
    const vaultId = selected?.vault.vaultId;
    const agent = selected?.policy.config.agent.toLowerCase();
    const live = profiles.find(
      (candidate) =>
        candidate.policy.status === 'ACTIVE' &&
        (vaultId ? candidate.vault.vaultId === vaultId : true) &&
        (agent ? candidate.policy.config.agent.toLowerCase() === agent : true),
    );
    return live ?? selected ?? profiles[0] ?? null;
  }, [profiles, selectedId]);

  useEffect(() => {
    if (!profile || !config || !owner) return;
    if (profile.id === selectedId) return;
    setSelectedId(profile.id);
    storage.setSelectedProfile(config.deploymentId, owner, profile.id);
  }, [profile, selectedId, config, owner]);

  const selectProfile = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (config && owner) storage.setSelectedProfile(config.deploymentId, owner, id);
    },
    [config, owner],
  );

  const accountMismatch =
    !!session && !!account && account.toLowerCase() !== session.walletAddress.toLowerCase();
  const wrongNetwork = !!config && !!walletChainId && walletChainId !== config.chainId;
  const canAct = !!session && !!account && !accountMismatch && !wrongNetwork;

  const value: AppState = {
    boot,
    retryBoot: () => setBootAttempt((n) => n + 1),
    walletAvailable: getProvider() !== null,
    account,
    walletChainId,
    session,
    sessionChecked,
    connecting,
    connectError,
    connect,
    signOut,
    fixNetwork,
    accountMismatch,
    wrongNetwork,
    canAct,
    profiles,
    profilesError,
    profilesRefreshedAt,
    refreshProfiles,
    profile,
    selectProfile,
    handleApiError,
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp(): AppState {
  const value = useContext(Context);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}

export function useConfig(): PublicConfig {
  const { boot } = useApp();
  if (boot.phase !== 'ready') throw new Error('config is not loaded');
  return boot.config;
}
