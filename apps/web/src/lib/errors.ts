/**
 * Error language. Product wording is layered ON TOP of the backend's own code and message, which
 * are always kept and shown -- never replaced. Unknown infrastructure state is never worded as a
 * policy BLOCK.
 */
import { PayGuardApiError } from '@payguard/integration';

export type ErrorKind = 'POLICY' | 'WALLET' | 'NETWORK' | 'SETTLEMENT' | 'SESSION' | 'REQUEST';

export interface UiError {
  kind: ErrorKind;
  title: string;
  text: string;
  code?: string;
  backendMessage?: string;
  requestId?: string;
  details?: unknown;
  retryable: boolean;
}

const BY_CODE: Record<string, { kind: ErrorKind; text: string }> = {
  INVALID_SESSION: { kind: 'SESSION', text: 'Your session ended. Sign in with your wallet again.' },
  CSRF_REQUIRED: {
    kind: 'SESSION',
    text: 'This tab lost its request token. Reload the page to recover the session.',
  },
  ORIGIN_NOT_ALLOWED: {
    kind: 'SESSION',
    text: 'The backend does not accept this page’s origin. Add it to API_ALLOWED_ORIGINS.',
  },
  RESOURCE_FORBIDDEN: {
    kind: 'SESSION',
    text: 'This wallet does not own that resource.',
  },
  RESOURCE_NOT_FOUND: { kind: 'REQUEST', text: 'PayGuard has no such resource.' },
  TOTAL_OUTPUT_BUDGET_EXCEEDED: {
    kind: 'POLICY',
    text: 'Payment blocked: it exceeds the policy’s total budget. An approval cannot override this.',
  },
  INPUT_BUDGET_EXCEEDED: {
    kind: 'POLICY',
    text: 'Payment blocked: it would spend more of the source asset than the policy allows.',
  },
  APPROVAL_REQUIRED: { kind: 'POLICY', text: 'This payment needs an exact owner approval first.' },
  INVALID_APPROVAL: {
    kind: 'POLICY',
    text: 'The approval does not match this payment, signer, nonce or expiry.',
  },
  INVALID_SIGNATURE: {
    kind: 'POLICY',
    text: 'A signature did not verify. No payment was created.',
  },
  ROUTE_MISMATCH: { kind: 'POLICY', text: 'The policy does not authorize the requested route.' },
  POLICY_VALIDATION_FAILED: { kind: 'POLICY', text: 'These policy limits are not valid together.' },
  INVOICE_ALREADY_PAID: {
    kind: 'POLICY',
    text: 'This invoice was already paid. Nothing was sent.',
  },
  INTENT_RETIRED: { kind: 'POLICY', text: 'This payment intent was replaced by a newer version.' },
  DRAFT_VERSION_CONFLICT: { kind: 'REQUEST', text: 'The draft changed elsewhere. Start again.' },
  CHAIN_STATE_UNKNOWN: {
    kind: 'NETWORK',
    text: 'PayGuard cannot read the chain right now. State is unknown, not blocked.',
  },
  DEPLOYMENT_MISMATCH: {
    kind: 'NETWORK',
    text: 'The backend is pointed at a different deployment. An operator has to correct it.',
  },
  NOT_READY: { kind: 'NETWORK', text: 'The backend is not ready yet.' },
  SETTLEMENT_REVERTED: {
    kind: 'SETTLEMENT',
    text: 'Settlement reverted. No PayGuard payment was completed.',
  },
  INTERNAL: { kind: 'NETWORK', text: 'The backend hit an internal error.' },
};

const TITLES: Record<ErrorKind, string> = {
  POLICY: 'Policy',
  WALLET: 'Wallet',
  NETWORK: 'Network',
  SETTLEMENT: 'Settlement',
  SESSION: 'Session',
  REQUEST: 'Request',
};

export class WalletError extends Error {
  readonly rejected: boolean;
  constructor(message: string, rejected = false) {
    super(message);
    this.name = 'WalletError';
    this.rejected = rejected;
  }
}

export function toUiError(error: unknown): UiError {
  if (error instanceof PayGuardApiError) {
    const known = BY_CODE[error.code];
    const kind = known?.kind ?? 'REQUEST';
    return {
      kind,
      title: TITLES[kind],
      text: known?.text ?? error.message,
      code: error.code,
      backendMessage: error.message,
      requestId: error.requestId,
      details: error.details,
      retryable: error.retryable,
    };
  }
  if (error instanceof WalletError) {
    return {
      kind: 'WALLET',
      title: TITLES.WALLET,
      text: error.message,
      retryable: !error.rejected,
    };
  }
  // A transport failure or a non-JSON proxy error: we could not reach the API at all.
  return {
    kind: 'NETWORK',
    title: TITLES.NETWORK,
    text: 'PayGuard’s backend could not be reached. Nothing is known about this request’s result.',
    backendMessage: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

export function isInvalidSession(error: unknown): boolean {
  return error instanceof PayGuardApiError && error.code === 'INVALID_SESSION';
}

/** Plain-language reading of the vault's own reason codes (REASON_WIRE). */
const REASONS: Record<string, string> = {
  OK: 'Inside every limit.',
  INVALID_SIGNATURE: 'A signature on this payment did not verify.',
  INACTIVE_POLICY: 'The policy is no longer active.',
  EXPIRED: 'The invoice, intent or policy has expired.',
  AGENT_REVOKED: 'The agent’s authority was revoked.',
  MERCHANT_NOT_ALLOWED: 'The merchant is not on this policy’s allowed list.',
  CATEGORY_MISMATCH: 'The spending category is not allowed by this policy.',
  TOKEN_MISMATCH: 'The invoice asks for a different settlement asset.',
  ROUTE_MISMATCH: 'The policy does not authorize this settlement route.',
  INVOICE_ALREADY_PAID: 'This invoice was already paid once.',
  NONCE_ALREADY_USED: 'This intent’s nonce was already used.',
  TOTAL_OUTPUT_BUDGET: 'It exceeds the agent’s total budget.',
  EPOCH_OUTPUT_BUDGET: 'It exceeds the budget for the current period.',
  INPUT_BUDGET: 'It would spend more source asset than the policy allows overall.',
  MAX_INPUT_LIMIT: 'It would spend more source asset than allowed for one payment.',
  ABOVE_ESCALATION_CEILING: 'It is above the most an owner approval can authorize.',
  APPROVAL_REQUIRED:
    'It is above the automatic limit, so the owner must approve this exact payment.',
  INVALID_APPROVAL: 'The owner approval does not match this payment.',
  EXECUTION_PAUSED: 'The owner paused payment execution.',
  INSUFFICIENT_BALANCE: 'The vault does not hold enough of the source asset.',
  SUBSIDY_UNAVAILABLE: 'A required subsidy is not available.',
  INVALID_AMOUNT: 'The amount is not valid.',
};

export function reasonText(reasonCode: string | null | undefined): string | null {
  if (!reasonCode) return null;
  return REASONS[reasonCode] ?? null;
}
