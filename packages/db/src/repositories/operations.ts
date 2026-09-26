/**
 * Durable async operations, including SPEC-006's ordered-step tracking for multi-transaction
 * owner actions (e.g. approve then deposit). `operations.result` holds `{steps: OperationStep[]}`
 * for multi-step operations; `operations.transaction_hash` (the single top-level column) is used
 * only for genuinely single-transaction operations, matching SPEC-006's resolution exactly:
 * "operations.transaction_hash ... stays NULL for multi-step deposits, with the per-step hashes
 * living in result.steps[].transactionHash instead."
 */

import type { OperationStatusWire } from '@payguard/domain';
import type pg from 'pg';
import { bytesToHex } from '../encoding.js';
import type { Queryable } from '../pool.js';
import { isOperationStatusTransitionAllowed } from '../stateTransitions.js';
import { InvalidStateTransitionError } from './payments.js';

export interface OperationStep {
  kind: string;
  transactionHash: string | null;
  status: 'PENDING' | 'SUBMITTED' | 'SUCCEEDED' | 'FAILED';
}

export interface OperationRow {
  id: string;
  principalWalletId: string;
  deploymentId: string;
  operationKind: string;
  resourceKind: string;
  resourceId: string;
  status: OperationStatusWire;
  immutableRequest: Buffer;
  requestDigest: Buffer;
  transactionHash: Buffer | null;
  result: { steps: OperationStep[] } | null;
  stateVersion: bigint;
  createdAt: Date;
  updatedAt: Date;
}

function mapRow(row: Record<string, unknown>): OperationRow {
  return {
    id: row.id as string,
    principalWalletId: row.principal_wallet_id as string,
    deploymentId: row.deployment_id as string,
    operationKind: row.operation_kind as string,
    resourceKind: row.resource_kind as string,
    resourceId: row.resource_id as string,
    status: row.status as OperationStatusWire,
    immutableRequest: row.immutable_request as Buffer,
    requestDigest: row.request_digest as Buffer,
    transactionHash: (row.transaction_hash as Buffer | null) ?? null,
    result: (row.result as OperationRow['result']) ?? null,
    stateVersion: BigInt(row.state_version as string),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export async function createOperation(
  client: pg.PoolClient,
  params: {
    id: string;
    principalWalletId: string;
    deploymentId: string;
    operationKind: string;
    resourceKind: string;
    resourceId: string;
    immutableRequest: Buffer;
    requestDigest: Buffer;
    /** Step kinds in execution order, e.g. ['APPROVE','DEPOSIT']. Omit for a single-transaction operation. */
    stepKinds?: string[];
  },
): Promise<OperationRow> {
  const result = params.stepKinds
    ? {
        steps: params.stepKinds.map((kind) => ({
          kind,
          transactionHash: null,
          status: 'PENDING' as const,
        })),
      }
    : null;
  const inserted = await client.query(
    `INSERT INTO operations (id, principal_wallet_id, deployment_id, operation_kind, resource_kind, resource_id, status, immutable_request, request_digest, result)
     VALUES ($1,$2,$3,$4,$5,$6,'QUEUED',$7,$8,$9)
     RETURNING *`,
    [
      params.id,
      params.principalWalletId,
      params.deploymentId,
      params.operationKind,
      params.resourceKind,
      params.resourceId,
      params.immutableRequest,
      params.requestDigest,
      result ? JSON.stringify(result) : null,
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('createOperation: INSERT ... RETURNING produced no row');
  return mapRow(row);
}

export async function getOperationById(db: Queryable, id: string): Promise<OperationRow | null> {
  const result = await db.query('SELECT * FROM operations WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

/**
 * Updates one step of a multi-step operation's ordered array. The operation only reaches
 * COMPLETED when the step that is the intended FINAL effect succeeds (SPEC-006) -- a completed
 * APPROVE step alone never marks the whole operation COMPLETED, matching API_CONTRACT.md's
 * "Approval alone is not deposit completion."
 */
export async function updateOperationStep(
  client: pg.PoolClient,
  params: {
    operationId: string;
    expectedVersion: bigint;
    currentStatus: OperationStatusWire;
    currentSteps: OperationStep[];
    stepIndex: number;
    stepStatus: OperationStep['status'];
    transactionHash?: Buffer;
  },
): Promise<{ updated: boolean; row: OperationRow | null }> {
  if (params.stepIndex < 0 || params.stepIndex >= params.currentSteps.length) {
    throw new RangeError(
      `stepIndex ${params.stepIndex} out of range for ${params.currentSteps.length} steps`,
    );
  }
  const steps = params.currentSteps.map((step, i) =>
    i === params.stepIndex
      ? {
          ...step,
          status: params.stepStatus,
          transactionHash: params.transactionHash
            ? bytesToHex(params.transactionHash)
            : step.transactionHash,
        }
      : step,
  );
  const isFinalStep = params.stepIndex === steps.length - 1;

  let nextStatus: OperationStatusWire | undefined;
  if (params.stepStatus === 'FAILED') nextStatus = 'FAILED';
  else if (params.stepStatus === 'SUCCEEDED' && isFinalStep) nextStatus = 'COMPLETED';
  else if (params.currentStatus === 'QUEUED' || params.currentStatus === 'UNKNOWN')
    nextStatus = 'IN_PROGRESS';

  if (
    nextStatus !== undefined &&
    !isOperationStatusTransitionAllowed(params.currentStatus, nextStatus)
  ) {
    throw new InvalidStateTransitionError('operationStatus', params.currentStatus, nextStatus);
  }

  const result = await client.query(
    `UPDATE operations
     SET result = $3, status = COALESCE($4, status), state_version = state_version + 1, updated_at = now()
     WHERE id = $1 AND state_version = $2
     RETURNING *`,
    [
      params.operationId,
      params.expectedVersion.toString(10),
      JSON.stringify({ steps }),
      nextStatus ?? null,
    ],
  );
  const row = result.rows[0];
  return { updated: !!row, row: row ? mapRow(row) : null };
}

/** For genuinely single-transaction operations only (revoke/pause/cancel-nonce, or an unblocked deposit). */
export async function completeSingleTransactionOperation(
  client: pg.PoolClient,
  params: {
    operationId: string;
    expectedVersion: bigint;
    currentStatus: OperationStatusWire;
    status: OperationStatusWire;
    transactionHash?: Buffer;
  },
): Promise<{ updated: boolean; row: OperationRow | null }> {
  if (!isOperationStatusTransitionAllowed(params.currentStatus, params.status)) {
    throw new InvalidStateTransitionError('operationStatus', params.currentStatus, params.status);
  }
  const result = await client.query(
    `UPDATE operations
     SET status = $3, transaction_hash = COALESCE($4, transaction_hash), state_version = state_version + 1, updated_at = now()
     WHERE id = $1 AND state_version = $2
     RETURNING *`,
    [
      params.operationId,
      params.expectedVersion.toString(10),
      params.status,
      params.transactionHash ?? null,
    ],
  );
  const row = result.rows[0];
  return { updated: !!row, row: row ? mapRow(row) : null };
}

/**
 * Finds an existing non-terminal operation for a given resource identity (Stage 4, SPEC-020).
 *
 * `POST /v1/payment-intents/{id}/submit` is authorized for EITHER the vault owner or the bound
 * agent, and API_CONTRACT.md requires "Repeating submit returns the same operation." Idempotency
 * keys cannot deliver that on their own, because they are scoped per principal
 * (`UNIQUE(principal_wallet_id, operation, client_key)`) -- an owner submit and an agent submit of
 * the same intent are different principals and would each create an operation and an outbox job.
 *
 * So submission is idempotent on the RESOURCE identity instead, independent of who submitted it.
 * Terminal FAILED operations are excluded so a genuinely failed submission can be retried; the
 * `one_open_submission_per_intent` partial unique index (migration 0004) enforces the same rule at
 * the database level, making this lookup an optimization rather than the sole guarantee.
 */
export async function findOpenOperationForResource(
  db: Queryable,
  params: { resourceKind: string; resourceId: string },
): Promise<OperationRow | null> {
  const result = await db.query(
    `SELECT * FROM operations
     WHERE resource_kind = $1 AND resource_id = $2 AND status <> 'FAILED'
     ORDER BY created_at
     LIMIT 1`,
    [params.resourceKind, params.resourceId],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

/**
 * Owner-scoped operation read. `operations.(resource_kind, resource_id)` is polymorphic and has no
 * foreign key, so a bare-id read cannot be authorized on its own; this scopes by the principal who
 * created the operation. Agent access to an operation goes through an explicit per-resource-kind
 * join performed by the API layer, never through this function.
 */
export async function getOperationForPrincipal(
  db: Queryable,
  params: { id: string; principalWalletId: string },
): Promise<OperationRow | null> {
  const result = await db.query(
    'SELECT * FROM operations WHERE id = $1 AND principal_wallet_id = $2',
    [params.id, params.principalWalletId],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}
