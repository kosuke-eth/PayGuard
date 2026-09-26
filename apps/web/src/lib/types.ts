/**
 * Response read-models for /v1 routes.
 *
 * Request shapes, enums, EIP-712 definitions and the vault ABI come from `@payguard/integration`
 * and are never re-declared here. The generated OpenAPI only records generic response envelopes,
 * so these interfaces mirror `docs/API_CONTRACT.md` and the implemented handlers in
 * `apps/api/src/routes/*`. If a handler changes, change it here -- never paper over a mismatch in
 * a component.
 */
import type {
  CONFIDENCE_WIRE,
  Evaluation,
  EXECUTION_STATUS_WIRE,
  ExceptionApproval,
  MerchantPermission,
  Observation,
  OPERATION_STATUS_WIRE,
  PolicyConfig,
  RECONCILIATION_WIRE,
  UnsignedTransaction,
} from '@payguard/integration';

export type ExecutionStatus = (typeof EXECUTION_STATUS_WIRE)[number];
export type Confidence = (typeof CONFIDENCE_WIRE)[number];
export type Reconciliation = (typeof RECONCILIATION_WIRE)[number];
export type OperationStatus = (typeof OPERATION_STATUS_WIRE)[number];
export type PolicyDecision = Evaluation['decision'];

export interface SessionInfo {
  walletAddress: string;
  sessionExpiresAt: string;
  csrfToken?: string | null;
}

export interface VaultSummary {
  vaultId: string;
  ownerAddress: string;
  address: string;
  deploymentId: string;
  chainId: string | null;
}

export interface VaultDetail extends VaultSummary {
  /** null = the API could not read the chain. That is "unknown", not "running". */
  executionPaused: boolean | null;
  balances: Array<{ token: string; symbol: string; amountAtomic: string }>;
  activePolicies: Array<{ policyResourceId: string; onchainPolicyId: string; agent: string }>;
  observation: Observation | null;
}

export interface PolicyView {
  policyId: string;
  onchainPolicyId: string;
  vault: string;
  config: PolicyConfig;
  merchants: MerchantPermission[];
  status: string;
  counters: { outputSpent: string; epochOutputSpent: string; inputSpent: string } | null;
  observation: Observation | null;
  configHash?: string;
}

export interface PaymentListItem {
  paymentId: string;
  vaultId: string;
  executionStatus: ExecutionStatus;
  createdAt: string;
}

export interface PaymentDetail {
  paymentId: string;
  vaultId: string;
  intentId: string | null;
  deploymentId: string | null;
  chainId: string | null;
  invoice: {
    invoiceId: string;
    recipient: string;
    outputToken: string;
    outputAmountAtomic: string;
  } | null;
  authorized: {
    inputToken: string | null;
    maxInputAtomic: string | null;
    routeId: string | null;
  } | null;
  policyDecision: PolicyDecision;
  executionStatus: ExecutionStatus;
  confidence: Confidence;
  reconciliation: Reconciliation;
  reasonCode: string | null;
  settlement: {
    actualInputAtomic: string | null;
    outputDeliveredAtomic: string | null;
    subsidyAmountAtomic: string;
  } | null;
  transaction: { hash: string; replacementOf: string | null } | null;
  observedAt: {
    blockNumber: string | null;
    blockHash: string;
    canonical: boolean;
    observedAt: string;
  } | null;
}

/** A payment joined with its list row, so the creation time is available to the UI. */
export interface PaymentRecord extends PaymentDetail {
  createdAt: string;
}

export interface TimelineEntry {
  eventId: string;
  type: string;
  createdAt: string;
  body: Record<string, unknown> | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface OperationView {
  operationId: string;
  resourceType: string;
  resourceId: string;
  status: OperationStatus;
  result?: unknown;
  transactionHash?: string | null;
}

export interface SubmitResult extends OperationView {
  paymentId: string;
  intentId: string;
  deduplicated?: boolean;
}

export interface TransactionView {
  hash: string;
  from: string | null;
  nonce: string | null;
  state: string;
  replacementOf: string | null;
  canonicalReceiptIdentity: {
    blockHash: string;
    blockNumber: string | null;
    canonical: boolean;
  } | null;
  confidence: Confidence | null;
}

export interface ApprovalTypedData {
  typedData: {
    domain: { name: string; version: string; chainId: number; verifyingContract: string };
    types: { ExceptionApproval: ReadonlyArray<{ name: string; type: string }> };
    primaryType: 'ExceptionApproval';
    message: ExceptionApproval;
  };
  expectedSigner: string | null;
  computedDigest: string;
  nonceUsedOrCancelled: boolean | null;
  review: {
    merchant: string;
    outputToken: string;
    exactOutputAtomic: string;
    inputToken: string;
    maxInputAtomic: string;
    routeId: string;
    override: 'AUTOMATIC_OUTPUT_CAP_ONLY';
    validUntil: string;
  };
}

export interface PreparedVaultTransactions {
  operationId: string;
  transactions: UnsignedTransaction[];
  review: {
    steps: Array<{ index: number; stepKind: string; decoded: unknown }>;
    multiStep: boolean;
  };
}

export interface PreparedPolicyTransaction {
  transaction: UnsignedTransaction;
  review: unknown;
  draftDigest?: string;
}

export interface DemoScenario {
  scenarioId: string;
  label: string;
  description: string;
  permittedProfileIds: string[];
  invoiceAmountAtomic: string;
  requiresSourcePayment: boolean;
}

export interface DemoProfile {
  profileId: string;
  label: string;
  vaultId: string;
  policyResourceId: string;
  routeKind: string;
  outputToken: string;
  available: boolean;
}

export type OrchestrationStatus =
  | 'REJECTED_INVALID_SIGNATURE'
  | 'BLOCKED'
  | 'AWAITING_APPROVAL'
  | 'QUEUED'
  | 'DUPLICATE_NOT_PAID_TWICE';

export interface DemoRun {
  runId: string;
  profileId?: string;
  scenarioId?: string;
  stage: 'invoice' | 'intent' | 'submit' | 'settled';
  orchestrationStatus: OrchestrationStatus;
  errorCode: string | null;
  paymentId: string | null;
  intentId: string | null;
  operationId: string | null;
  livePaymentStatus?: {
    executionStatus: ExecutionStatus;
    reconciliation: Reconciliation;
    policyDecision: PolicyDecision;
  } | null;
}

/** One selectable vault + policy pair. Its route is part of the policy, never switched alone. */
export interface Profile {
  id: string;
  vault: VaultDetail;
  policy: PolicyView;
}
