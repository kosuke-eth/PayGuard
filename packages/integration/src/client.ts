/**
 * Small documented client boundary.
 *
 * This is the complete dependency surface an external client -- CLI, browser, or otherwise --
 * needs to talk to the PayGuard API: envelope types, response/error shapes, and a thin `fetch`
 * wrapper that unwraps `Success<T>`/`Failure` and throws a typed `PayGuardApiError` on failure.
 * It contains no business logic and no route-construction cleverness; a real frontend can use it
 * directly or treat it as a reference for its own HTTP layer.
 *
 * `packages/integration/test/external-consumer.test.ts` exercises this exact module (plus the
 * schemas/EIP-712 helpers re-exported from index.ts) as an external CLI-style consumer would,
 * using nothing from @payguard/db or @payguard/chain.
 */

export interface SuccessEnvelope<T> {
  data: T;
  requestId: string;
}

export interface FailureEnvelope {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requestId: string;
    details?: Record<string, unknown>;
  };
}

export class PayGuardApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(envelope: FailureEnvelope['error']) {
    super(envelope.message);
    this.name = 'PayGuardApiError';
    this.code = envelope.code;
    this.retryable = envelope.retryable;
    this.requestId = envelope.requestId;
    this.details = envelope.details;
  }
}

export interface PayGuardClientOptions {
  baseUrl: string;
  /** Set for an AGENT session; a BROWSER session instead relies on cookies via `fetchImpl`. */
  accessToken?: string;
  csrfToken?: string;
  idempotencyKey?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Issues one request against the PayGuard API and returns the unwrapped `data`. Throws
 * `PayGuardApiError` on a Failure envelope, or the raw network error on a transport failure --
 * a caller can distinguish "the API said no" from "we couldn't reach the API" without parsing
 * strings.
 */
export async function callPayGuardApi<T>(
  options: PayGuardClientOptions,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.accessToken) headers.authorization = `Bearer ${options.accessToken}`;
  if (options.csrfToken) headers['x-csrf-token'] = options.csrfToken;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  const response = await fetchImpl(`${options.baseUrl}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const json = (await response.json()) as SuccessEnvelope<T> | FailureEnvelope;
  if ('error' in json) {
    throw new PayGuardApiError(json.error);
  }
  return json.data;
}

/** Thin, explicit wrappers over the endpoints an external client needs first. Add more as needed. */
export function createPayGuardClient(options: PayGuardClientOptions) {
  return {
    getConfig: <T>() => callPayGuardApi<T>(options, 'GET', '/v1/config'),
    createAuthChallenge: <T>(body: {
      address: string;
      chainId: string;
      sessionKind: 'BROWSER' | 'AGENT';
    }) => callPayGuardApi<T>(options, 'POST', '/v1/auth/challenges', body),
    verifyAuthChallenge: <T>(body: { challengeId: string; signature: string }) =>
      callPayGuardApi<T>(options, 'POST', '/v1/auth/verify', body),
    submitInvoice: <T>(body: { vaultId: string; invoice: unknown; merchantSignature: string }) =>
      callPayGuardApi<T>(options, 'POST', '/v1/invoices', body),
    createPaymentIntent: <T>(body: unknown) =>
      callPayGuardApi<T>(options, 'POST', '/v1/payment-intents', body),
    getPayment: <T>(paymentId: string) =>
      callPayGuardApi<T>(options, 'GET', `/v1/payments/${paymentId}`),
    /** B2 demo bridge, demo-configured deployments only -- see `DEMO_RUN_START_BODY`. */
    listDemoScenarios: <T>() => callPayGuardApi<T>(options, 'GET', '/v1/demo/scenarios'),
    startDemoRun: <T>(body: { profileId: string; scenarioId: string; sourcePaymentId?: string }) =>
      callPayGuardApi<T>(options, 'POST', '/v1/demo/runs', body),
    getDemoRun: <T>(runId: string) => callPayGuardApi<T>(options, 'GET', `/v1/demo/runs/${runId}`),
  };
}

export type PayGuardClient = ReturnType<typeof createPayGuardClient>;
