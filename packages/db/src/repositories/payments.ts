/**
 * Invoices, one-payment-per-invoice, versioned intents, approvals, and the payments state
 * compare-and-set updater (Prompt 3 items 3-4). Explicit use-case queries, not a generic
 * repository layer.
 */

import type {
  ConfidenceWire,
  ExecutionStatusWire,
  PolicyDecisionWire,
  ReconciliationWire,
} from '@payguard/domain';
import type pg from 'pg';
import type { Queryable } from '../pool.js';
import {
  isConfidenceTransitionAllowed,
  isExecutionStatusTransitionAllowed,
  isPolicyDecisionTransitionAllowed,
  isReconciliationTransitionAllowed,
} from '../stateTransitions.js';

export class InvalidStateTransitionError extends Error {
  readonly axis: string;
  readonly from: string;
  readonly to: string;

  constructor(axis: string, from: string, to: string) {
    super(`illegal ${axis} transition: ${from} -> ${to}`);
    this.name = 'InvalidStateTransitionError';
    this.axis = axis;
    this.from = from;
    this.to = to;
  }
}

// --- invoices ---------------------------------------------------------------------------------

export interface InvoiceRow {
  id: string;
  vaultId: string;
  invoiceId: Buffer;
  recipient: Buffer;
  merchantId: Buffer;
  settlementToken: Buffer;
  outputAmount: bigint;
  validUntil: bigint;
  invoiceDigest: Buffer;
  artifactId: string;
}

function mapInvoiceRow(row: Record<string, unknown>): InvoiceRow {
  return {
    id: row.id as string,
    vaultId: row.vault_id as string,
    invoiceId: row.invoice_id as Buffer,
    recipient: row.recipient as Buffer,
    merchantId: row.merchant_id as Buffer,
    settlementToken: row.settlement_token as Buffer,
    outputAmount: BigInt(row.output_amount as string),
    validUntil: BigInt(row.valid_until as string),
    invoiceDigest: row.invoice_digest as Buffer,
    artifactId: row.artifact_id as string,
  };
}

export type CreateInvoiceResult =
  | { kind: 'created'; row: InvoiceRow }
  | { kind: 'existing'; row: InvoiceRow }
  /** Same (vault, recipient, invoiceId) but different bytes -- caller returns 409 INVOICE_ID_REUSED. */
  | { kind: 'conflict'; row: InvoiceRow };

/** API_CONTRACT.md POST /v1/invoices: same identity + changed bytes is 409, not a new obligation. */
export async function createOrGetInvoice(
  client: pg.PoolClient,
  params: {
    id: string;
    vaultId: string;
    invoiceId: Buffer;
    recipient: Buffer;
    merchantId: Buffer;
    settlementToken: Buffer;
    outputAmount: bigint;
    validUntil: bigint;
    invoiceDigest: Buffer;
    artifactId: string;
  },
): Promise<CreateInvoiceResult> {
  const inserted = await client.query(
    `INSERT INTO invoices (id, vault_id, invoice_id, recipient, merchant_id, settlement_token, output_amount, valid_until, invoice_digest, artifact_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (vault_id, recipient, invoice_id) DO NOTHING
     RETURNING *`,
    [
      params.id,
      params.vaultId,
      params.invoiceId,
      params.recipient,
      params.merchantId,
      params.settlementToken,
      params.outputAmount.toString(10),
      params.validUntil.toString(10),
      params.invoiceDigest,
      params.artifactId,
    ],
  );
  if (inserted.rows[0]) return { kind: 'created', row: mapInvoiceRow(inserted.rows[0]) };

  const existing = await client.query(
    `SELECT * FROM invoices WHERE vault_id = $1 AND recipient = $2 AND invoice_id = $3 FOR UPDATE`,
    [params.vaultId, params.recipient, params.invoiceId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error('createOrGetInvoice: conflict but no existing row found (race?)');
  const mapped = mapInvoiceRow(row);
  return mapped.invoiceDigest.equals(params.invoiceDigest)
    ? { kind: 'existing', row: mapped }
    : { kind: 'conflict', row: mapped };
}

// --- payments -----------------------------------------------------------------------------------

export interface PaymentRow {
  id: string;
  vaultId: string;
  invoiceId: string;
  policyDecision: PolicyDecisionWire;
  executionStatus: ExecutionStatusWire;
  confidence: ConfidenceWire;
  reconciliation: ReconciliationWire;
  reasonCode: string | null;
  stateVersion: bigint;
  observedBlockHash: Buffer | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapPaymentRow(row: Record<string, unknown>): PaymentRow {
  return {
    id: row.id as string,
    vaultId: row.vault_id as string,
    invoiceId: row.invoice_id as string,
    policyDecision: row.policy_decision as PolicyDecisionWire,
    executionStatus: row.execution_status as ExecutionStatusWire,
    confidence: row.confidence as ConfidenceWire,
    reconciliation: row.reconciliation as ReconciliationWire,
    reasonCode: (row.reason_code as string | null) ?? null,
    stateVersion: BigInt(row.state_version as string),
    observedBlockHash: (row.observed_block_hash as Buffer | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export type CreatePaymentResult =
  | { kind: 'created'; row: PaymentRow }
  | { kind: 'existing'; row: PaymentRow };

/**
 * One logical payment per invoice, enforced by `payments.invoice_id UNIQUE` at the database
 * level -- this is what makes "one logical payment under concurrent invoice submission" actually
 * safe under real concurrency, not just safe in the single-writer case a mock would hide.
 */
export async function createPaymentForInvoice(
  client: pg.PoolClient,
  params: {
    id: string;
    vaultId: string;
    invoiceId: string;
    policyDecision: PolicyDecisionWire;
  },
): Promise<CreatePaymentResult> {
  const inserted = await client.query(
    `INSERT INTO payments (id, vault_id, invoice_id, policy_decision, execution_status, confidence, reconciliation)
     VALUES ($1,$2,$3,$4,'DRAFT','UNOBSERVED','NOT_CHECKED')
     ON CONFLICT (invoice_id) DO NOTHING
     RETURNING *`,
    [params.id, params.vaultId, params.invoiceId, params.policyDecision],
  );
  if (inserted.rows[0]) return { kind: 'created', row: mapPaymentRow(inserted.rows[0]) };

  const existing = await client.query('SELECT * FROM payments WHERE invoice_id = $1', [
    params.invoiceId,
  ]);
  const row = existing.rows[0];
  if (!row) throw new Error('createPaymentForInvoice: conflict but no existing row found (race?)');
  return { kind: 'existing', row: mapPaymentRow(row) };
}

export async function getPaymentById(db: Queryable, id: string): Promise<PaymentRow | null> {
  const result = await db.query('SELECT * FROM payments WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapPaymentRow(row) : null;
}

/**
 * State-axis compare-and-set update. `current` must be the caller's own just-read view of the
 * row (policyDecision/executionStatus/confidence/reconciliation + stateVersion) -- this function
 * validates every axis actually being changed against that view via the pure transition
 * functions, then issues one `UPDATE ... WHERE id = $1 AND state_version = $2` so the update only
 * commits if nothing else touched the row between the caller's read and this write. A 0-row
 * result (`updated: false`) means someone else changed it first; the caller re-reads and retries
 * or aborts, it never blindly overwrites.
 */
export async function updatePaymentState(
  client: pg.PoolClient,
  params: {
    paymentId: string;
    expectedVersion: bigint;
    current: {
      policyDecision: PolicyDecisionWire;
      executionStatus: ExecutionStatusWire;
      confidence: ConfidenceWire;
      reconciliation: ReconciliationWire;
    };
    next: {
      policyDecision?: PolicyDecisionWire;
      executionStatus?: ExecutionStatusWire;
      confidence?: ConfidenceWire;
      reconciliation?: ReconciliationWire;
      reasonCode?: string | null;
      observedBlockHash?: Buffer | null;
    };
  },
): Promise<{ updated: boolean; row: PaymentRow | null }> {
  if (params.next.policyDecision !== undefined) {
    if (
      !isPolicyDecisionTransitionAllowed(params.current.policyDecision, params.next.policyDecision)
    ) {
      throw new InvalidStateTransitionError(
        'policyDecision',
        params.current.policyDecision,
        params.next.policyDecision,
      );
    }
  }
  if (params.next.executionStatus !== undefined) {
    if (
      !isExecutionStatusTransitionAllowed(
        params.current.executionStatus,
        params.next.executionStatus,
      )
    ) {
      throw new InvalidStateTransitionError(
        'executionStatus',
        params.current.executionStatus,
        params.next.executionStatus,
      );
    }
  }
  if (params.next.confidence !== undefined) {
    if (!isConfidenceTransitionAllowed(params.current.confidence, params.next.confidence)) {
      throw new InvalidStateTransitionError(
        'confidence',
        params.current.confidence,
        params.next.confidence,
      );
    }
  }
  if (params.next.reconciliation !== undefined) {
    if (
      !isReconciliationTransitionAllowed(params.current.reconciliation, params.next.reconciliation)
    ) {
      throw new InvalidStateTransitionError(
        'reconciliation',
        params.current.reconciliation,
        params.next.reconciliation,
      );
    }
  }

  const result = await client.query(
    `UPDATE payments
     SET policy_decision = COALESCE($3, policy_decision),
         execution_status = COALESCE($4, execution_status),
         confidence = COALESCE($5, confidence),
         reconciliation = COALESCE($6, reconciliation),
         reason_code = CASE WHEN $7::boolean THEN $8 ELSE reason_code END,
         observed_block_hash = CASE WHEN $9::boolean THEN $10 ELSE observed_block_hash END,
         state_version = state_version + 1,
         updated_at = now()
     WHERE id = $1 AND state_version = $2
     RETURNING *`,
    [
      params.paymentId,
      params.expectedVersion.toString(10),
      params.next.policyDecision ?? null,
      params.next.executionStatus ?? null,
      params.next.confidence ?? null,
      params.next.reconciliation ?? null,
      'reasonCode' in params.next,
      params.next.reasonCode ?? null,
      'observedBlockHash' in params.next,
      params.next.observedBlockHash ?? null,
    ],
  );
  const row = result.rows[0];
  return { updated: !!row, row: row ? mapPaymentRow(row) : null };
}

// --- payment_intents ------------------------------------------------------------------------

export interface PaymentIntentRow {
  id: string;
  paymentId: string;
  vaultId: string;
  policyId: string;
  version: bigint;
  intentDigest: Buffer;
  artifactId: string;
  agentNonce: bigint;
  maxInputAmount: bigint;
  validUntil: bigint;
  retiredAt: Date | null;
}

function mapIntentRow(row: Record<string, unknown>): PaymentIntentRow {
  return {
    id: row.id as string,
    paymentId: row.payment_id as string,
    vaultId: row.vault_id as string,
    policyId: row.policy_id as string,
    version: BigInt(row.version as string),
    intentDigest: row.intent_digest as Buffer,
    artifactId: row.artifact_id as string,
    agentNonce: BigInt(row.agent_nonce as string),
    maxInputAmount: BigInt(row.max_input_amount as string),
    validUntil: BigInt(row.valid_until as string),
    retiredAt: (row.retired_at as Date | null) ?? null,
  };
}

/**
 * Retires whatever intent version is currently active for this payment (if any) and inserts the
 * new one as the sole active version, inside the caller's transaction -- both statements must
 * commit or roll back together so `one_active_intent_per_payment` is never violated and no
 * payment is ever left with zero active versions mid-flight.
 */
export async function createIntentVersion(
  client: pg.PoolClient,
  params: {
    id: string;
    paymentId: string;
    vaultId: string;
    policyId: string;
    version: bigint;
    intentDigest: Buffer;
    artifactId: string;
    agentNonce: bigint;
    maxInputAmount: bigint;
    validUntil: bigint;
  },
): Promise<PaymentIntentRow> {
  await client.query(
    'UPDATE payment_intents SET retired_at = now() WHERE payment_id = $1 AND retired_at IS NULL',
    [params.paymentId],
  );
  // `intent_digest` is UNIQUE across the whole table. Two concurrent requests for the identical
  // signed intent (e.g. an agent's network-timeout retry racing the original call) both retire the
  // same already-retired-by-then row harmlessly, but would both attempt this INSERT -- the loser
  // must observe the winner's row, not a raw unique-violation 500.
  const inserted = await client.query(
    `INSERT INTO payment_intents (id, payment_id, vault_id, policy_id, version, intent_digest, artifact_id, agent_nonce, max_input_amount, valid_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (intent_digest) DO NOTHING
     RETURNING *`,
    [
      params.id,
      params.paymentId,
      params.vaultId,
      params.policyId,
      params.version.toString(10),
      params.intentDigest,
      params.artifactId,
      params.agentNonce.toString(10),
      params.maxInputAmount.toString(10),
      params.validUntil.toString(10),
    ],
  );
  if (inserted.rows[0]) return mapIntentRow(inserted.rows[0]);

  const existing = await client.query('SELECT * FROM payment_intents WHERE intent_digest = $1', [
    params.intentDigest,
  ]);
  const row = existing.rows[0];
  if (!row) throw new Error('createIntentVersion: conflicting row vanished before readback');
  return mapIntentRow(row);
}

export async function getActiveIntent(
  db: Queryable,
  paymentId: string,
): Promise<PaymentIntentRow | null> {
  const result = await db.query(
    'SELECT * FROM payment_intents WHERE payment_id = $1 AND retired_at IS NULL',
    [paymentId],
  );
  const row = result.rows[0];
  return row ? mapIntentRow(row) : null;
}

// --- approvals -------------------------------------------------------------------------------

export interface ApprovalRow {
  id: string;
  intentId: string;
  vaultId: string;
  approvalDigest: Buffer;
  approvalNonce: bigint;
  artifactId: string;
  validUntil: bigint;
  observedConsumedTxHash: Buffer | null;
  observedCancelled: boolean;
}

function mapApprovalRow(row: Record<string, unknown>): ApprovalRow {
  return {
    id: row.id as string,
    intentId: row.intent_id as string,
    vaultId: row.vault_id as string,
    approvalDigest: row.approval_digest as Buffer,
    approvalNonce: BigInt(row.approval_nonce as string),
    artifactId: row.artifact_id as string,
    validUntil: BigInt(row.valid_until as string),
    observedConsumedTxHash: (row.observed_consumed_tx_hash as Buffer | null) ?? null,
    observedCancelled: row.observed_cancelled as boolean,
  };
}

/**
 * Idempotent on `(intent_id, approval_digest)` -- both `approvalNonce` and `approvalDigest` are
 * fully deterministic from the intent (nonce = uint256(intentHash)), so a legitimate owner retry
 * of an already-signed approval (e.g. the client never saw the `201` due to a network drop) is
 * byte-identical and must return the ORIGINAL approval, never a raw unique-violation 500.
 */
export async function createApproval(
  client: pg.PoolClient,
  params: {
    id: string;
    intentId: string;
    vaultId: string;
    approvalDigest: Buffer;
    approvalNonce: bigint;
    artifactId: string;
    validUntil: bigint;
  },
): Promise<ApprovalRow> {
  const inserted = await client.query(
    `INSERT INTO approvals (id, intent_id, vault_id, approval_digest, approval_nonce, artifact_id, valid_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (intent_id, approval_digest) DO NOTHING
     RETURNING *`,
    [
      params.id,
      params.intentId,
      params.vaultId,
      params.approvalDigest,
      params.approvalNonce.toString(10),
      params.artifactId,
      params.validUntil.toString(10),
    ],
  );
  if (inserted.rows[0]) return mapApprovalRow(inserted.rows[0]);

  const existing = await client.query(
    'SELECT * FROM approvals WHERE intent_id = $1 AND approval_digest = $2',
    [params.intentId, params.approvalDigest],
  );
  const row = existing.rows[0];
  if (!row) throw new Error('createApproval: conflicting row vanished before readback');
  return mapApprovalRow(row);
}
