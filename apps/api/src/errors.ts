/**
 * Stable error codes and the success/failure envelopes from API_CONTRACT.md.
 *
 * Codes are part of the wire contract -- a client branches on `error.code`, never on the English
 * `message`. `retryable` is set per code so a client can tell "fix your request" from "try again".
 *
 * Note the deliberate separation API_CONTRACT.md calls out: a readable ESCALATE decision is a
 * normal 200 evaluation response, NOT an API failure. Only a rejected *command* becomes an error
 * envelope.
 */

export const ERROR_CODES = {
  INVALID_SCHEMA: { status: 400, retryable: false },
  INVALID_SESSION: { status: 401, retryable: false },
  CSRF_REQUIRED: { status: 403, retryable: false },
  ORIGIN_NOT_ALLOWED: { status: 403, retryable: false },
  RESOURCE_FORBIDDEN: { status: 403, retryable: false },
  RESOURCE_NOT_FOUND: { status: 404, retryable: false },
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, retryable: false },
  IDEMPOTENCY_KEY_REUSED: { status: 409, retryable: false },
  DRAFT_VERSION_CONFLICT: { status: 409, retryable: false },
  INVOICE_ID_REUSED: { status: 409, retryable: false },
  INVOICE_ALREADY_PAID: { status: 409, retryable: false },
  INTENT_RETIRED: { status: 409, retryable: false },
  TOTAL_OUTPUT_BUDGET_EXCEEDED: { status: 422, retryable: false },
  INPUT_BUDGET_EXCEEDED: { status: 422, retryable: false },
  APPROVAL_REQUIRED: { status: 422, retryable: false },
  INVALID_APPROVAL: { status: 422, retryable: false },
  INVALID_SIGNATURE: { status: 422, retryable: false },
  ROUTE_MISMATCH: { status: 422, retryable: false },
  POLICY_VALIDATION_FAILED: { status: 422, retryable: false },
  /** Infrastructure could not answer. Explicitly NOT a policy denial. */
  CHAIN_STATE_UNKNOWN: { status: 503, retryable: true },
  DEPLOYMENT_MISMATCH: { status: 503, retryable: false },
  NOT_READY: { status: 503, retryable: true },
  INTERNAL: { status: 500, retryable: true },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_CODES[this.code].status;
  }

  get retryable(): boolean {
    return ERROR_CODES[this.code].retryable;
  }
}

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

export function successEnvelope<T>(data: T, requestId: string): SuccessEnvelope<T> {
  return { data, requestId };
}

export function failureEnvelope(error: ApiError, requestId: string): FailureEnvelope {
  return {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      requestId,
      ...(error.details ? { details: error.details } : {}),
    },
  };
}

/**
 * Maps a decoded contract Reason to the API's stable error code. Used when a *command* is rejected
 * because of a contract answer -- an evaluation response carries the Reason verbatim instead.
 */
export function errorCodeForReason(reason: string): ErrorCode {
  switch (reason) {
    case 'TOTAL_OUTPUT_BUDGET':
    case 'EPOCH_OUTPUT_BUDGET':
      return 'TOTAL_OUTPUT_BUDGET_EXCEEDED';
    case 'INPUT_BUDGET':
    case 'MAX_INPUT_LIMIT':
      return 'INPUT_BUDGET_EXCEEDED';
    case 'APPROVAL_REQUIRED':
      return 'APPROVAL_REQUIRED';
    case 'INVALID_APPROVAL':
      return 'INVALID_APPROVAL';
    case 'INVALID_SIGNATURE':
      return 'INVALID_SIGNATURE';
    case 'ROUTE_MISMATCH':
      return 'ROUTE_MISMATCH';
    case 'INVOICE_ALREADY_PAID':
      return 'INVOICE_ALREADY_PAID';
    default:
      return 'POLICY_VALIDATION_FAILED';
  }
}
