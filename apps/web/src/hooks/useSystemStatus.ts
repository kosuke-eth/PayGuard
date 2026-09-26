import { api } from '../lib/payguard-client';
import { usePolling } from './usePolling';

export interface ReadinessCheck {
  name: string;
  ok: boolean;
  detail?: string;
}
export interface Readiness {
  status: 'READY' | 'NOT_READY';
  readyForPaymentExecution: boolean;
  checks: ReadinessCheck[];
}

const CHECK_TEXT: Record<string, { label: string; down: string }> = {
  database: { label: 'Payment records', down: 'Payment history is unavailable.' },
  deployment: { label: 'Deployment', down: 'The backend is pointed at an unknown deployment.' },
  chain: { label: 'Blockchain connection', down: 'The backend cannot reach the chain.' },
  worker: {
    label: 'Relayer',
    down: 'The relayer is offline. Approved payments queue until it returns.',
  },
  relayer: { label: 'Relayer gas balance', down: 'The relayer cannot pay for gas.' },
  relayerBalance: { label: 'Relayer gas balance', down: 'The relayer cannot pay for gas.' },
  vaultCode: {
    label: 'Vault contract integrity',
    down: 'A vault’s on-chain code no longer matches its record.',
  },
};

export function describeCheck(check: ReadinessCheck): { label: string; text: string } {
  const known = CHECK_TEXT[check.name];
  return {
    label: known?.label ?? check.name,
    text: check.ok ? 'Operational' : (known?.down ?? check.detail ?? 'Not ready'),
  };
}

/**
 * Service health, read from the backend's own readiness probe. It is shown as a status indicator
 * only; it never gates or fakes anything in the app.
 */
export function useSystemStatus() {
  return usePolling<Readiness>(
    'system-status',
    () => api.getReadiness() as Promise<Readiness>,
    () => 20000,
  );
}
