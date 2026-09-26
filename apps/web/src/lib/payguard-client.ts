/**
 * The single HTTP boundary of the frontend.
 *
 * Every call goes through `callPayGuardApi` from `@payguard/integration` (same-origin, cookie
 * session). `createPayGuardClient` only names a few routes, so the remaining implemented /v1
 * routes are reached through the same generic function rather than a second fetch layer.
 *
 * CSRF: the token lives in memory only. After a reload it is recovered by GET /v1/auth/session,
 * which ROTATES it -- so the most recent value always wins.
 */

import type { ExceptionApproval, MerchantPermission, PolicyConfig } from '@payguard/integration';
import { callPayGuardApi, PayGuardApiError, type PublicConfig } from '@payguard/integration';
import type {
  ApprovalTypedData,
  DemoProfile,
  DemoRun,
  DemoScenario,
  OperationView,
  Page,
  PaymentDetail,
  PaymentListItem,
  PolicyView,
  PreparedPolicyTransaction,
  PreparedVaultTransactions,
  SessionInfo,
  SubmitResult,
  TimelineEntry,
  TransactionView,
  VaultDetail,
  VaultSummary,
} from './types';

let csrfToken: string | undefined;
let sessionRecovery: Promise<SessionInfo> | null = null;

export function setCsrfToken(token: string | null | undefined): void {
  csrfToken = token ?? undefined;
}

const sameOriginFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: 'same-origin' });

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

async function call<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  return callPayGuardApi<T>(
    {
      baseUrl: '',
      fetchImpl: sameOriginFetch,
      ...(csrfToken && method !== 'GET' ? { csrfToken } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
    method,
    path,
    body,
  );
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
}

export type VaultAction =
  | { action: 'DEPOSIT'; token: string; amountAtomic: string }
  | { action: 'WITHDRAW'; token: string; amountAtomic: string; recipient: string }
  | { action: 'REVOKE_AGENT'; agent: string }
  | { action: 'SET_EXECUTION_PAUSED'; paused: boolean };

export const api = {
  getConfig: () => call<PublicConfig>('GET', '/v1/config'),
  /** Answers 503 with a normal data envelope when not ready, so the checks are readable either way. */
  getReadiness: () => call<unknown>('GET', '/health/ready'),

  // --- auth ---
  createChallenge: (address: string, chainId: string) =>
    call<{ challengeId: string; message: string; expiresAt: string }>(
      'POST',
      '/v1/auth/challenges',
      { address, chainId, sessionKind: 'BROWSER' },
    ),
  verifyChallenge: (challengeId: string, signature: string) =>
    call<SessionInfo>('POST', '/v1/auth/verify', { challengeId, signature }),
  /**
   * Every call ROTATES the CSRF token server-side, so concurrent recoveries would race each other
   * into a stale token. One in-flight recovery is shared by all callers (React StrictMode included).
   */
  recoverSession: (): Promise<SessionInfo> => {
    sessionRecovery ??= call<SessionInfo>('GET', '/v1/auth/session').finally(() => {
      sessionRecovery = null;
    });
    return sessionRecovery;
  },
  logout: () => call<{ revoked: boolean }>('POST', '/v1/auth/logout', {}),

  // --- vaults / policies ---
  listVaults: () => call<Page<VaultSummary>>('GET', '/v1/vaults?limit=50'),
  getVault: (vaultId: string) => call<VaultDetail>('GET', `/v1/vaults/${vaultId}`),
  prepareVaultAction: (vaultId: string, action: VaultAction, key: string) =>
    call<PreparedVaultTransactions>('POST', `/v1/vaults/${vaultId}/transactions`, action, key),
  getPolicy: (policyId: string) => call<PolicyView>('GET', `/v1/policies/${policyId}`),
  createPolicyDraft: (vaultId: string, config: PolicyConfig, merchants: MerchantPermission[]) =>
    call<{ draftId: string; draftVersion: string }>('POST', '/v1/policy-drafts', {
      vaultId,
      config,
      merchants,
    }),
  preparePolicyTransaction: (draftId: string, expectedVersion: string) =>
    call<PreparedPolicyTransaction>('POST', `/v1/policy-drafts/${draftId}/transaction`, {
      expectedVersion,
    }),
  prepareRevocation: (policyId: string) =>
    call<PreparedPolicyTransaction>('POST', `/v1/policies/${policyId}/revocation-transaction`, {}),
  reportTransaction: (deploymentId: string, txHash: string, relatedResourceId: string) =>
    call<OperationView>('POST', '/v1/chain-observations', {
      deploymentId,
      txHash,
      relatedResourceId,
    }),

  // --- payments ---
  listPayments: (params: { cursor?: string; status?: string; limit?: number } = {}) =>
    call<Page<PaymentListItem>>(
      'GET',
      `/v1/payments${query({
        cursor: params.cursor,
        status: params.status,
        limit: String(params.limit ?? 25),
      })}`,
    ),
  getPayment: (paymentId: string) => call<PaymentDetail>('GET', `/v1/payments/${paymentId}`),
  getTimeline: (paymentId: string) =>
    call<Page<TimelineEntry>>('GET', `/v1/payments/${paymentId}/timeline?limit=100`),
  getTransaction: (hash: string, deploymentId: string) =>
    call<TransactionView>('GET', `/v1/transactions/${hash}${query({ deploymentId })}`),
  getOperation: (operationId: string) =>
    call<OperationView>('GET', `/v1/operations/${operationId}`),

  // --- approvals ---
  getApprovalTypedData: (intentId: string) =>
    call<ApprovalTypedData>('GET', `/v1/payment-intents/${intentId}/approval-typed-data`),
  submitApproval: (intentId: string, approval: ExceptionApproval, ownerSignature: string) =>
    call<{ approvalId: string; status: 'SIGNED' }>(
      'POST',
      `/v1/payment-intents/${intentId}/approvals`,
      { approval, ownerSignature },
    ),
  submitIntent: (intentId: string, key: string) =>
    call<SubmitResult>('POST', `/v1/payment-intents/${intentId}/submit`, {}, key),

  // --- demo bridge ---
  getDemoCatalog: () =>
    call<{ scenarios: DemoScenario[]; profiles: DemoProfile[] }>('GET', '/v1/demo/scenarios'),
  startDemoRun: (
    body: { profileId: string; scenarioId: string; sourcePaymentId?: string },
    key: string,
  ) => call<DemoRun>('POST', '/v1/demo/runs', body, key),
  getDemoRun: (runId: string) => call<DemoRun>('GET', `/v1/demo/runs/${runId}`),
};

export { PayGuardApiError };
