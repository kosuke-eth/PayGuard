/**
 * Idempotency-key repository (ARCH 3.2 "Idempotency and outbox algorithm"; Prompt 3 item 5).
 *
 * `beginIdempotentRequest` must be called with an already-checked-out client that will go on to
 * insert the actual resource/outbox-row(s) in the SAME transaction -- "Create idempotency
 * record, resource/operation, and due work atomically." This function only handles the
 * idempotency_keys row itself; the caller inserts everything else before committing.
 */
import type pg from 'pg';

export interface IdempotencyKeyRow {
  id: string;
  principalWalletId: string;
  operation: string;
  clientKey: string;
  requestDigest: Buffer;
  resourceKind: string | null;
  resourceId: string | null;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED_RETRYABLE' | 'FAILED_TERMINAL';
  responseStatus: number | null;
  responseBody: unknown;
  createdAt: Date;
}

function mapRow(row: Record<string, unknown>): IdempotencyKeyRow {
  return {
    id: row.id as string,
    principalWalletId: row.principal_wallet_id as string,
    operation: row.operation as string,
    clientKey: row.client_key as string,
    requestDigest: row.request_digest as Buffer,
    resourceKind: (row.resource_kind as string | null) ?? null,
    resourceId: (row.resource_id as string | null) ?? null,
    status: row.status as IdempotencyKeyRow['status'],
    responseStatus: (row.response_status as number | null) ?? null,
    responseBody: row.response_body ?? null,
    createdAt: row.created_at as Date,
  };
}

export type BeginIdempotentRequestResult =
  | { kind: 'created'; row: IdempotencyKeyRow }
  | { kind: 'existing'; row: IdempotencyKeyRow }
  /** Same (principal, operation, clientKey) but a materially different request body -- caller returns 409. */
  | { kind: 'conflict'; row: IdempotencyKeyRow };

/**
 * `requestDigest` must already be the hash of the CANONICALIZED, fixed typed business fields of
 * the request (API_CONTRACT.md's definition of "identical work") -- never a new requestId or a
 * mutable estimate. Two calls with the same key and the same canonical digest are the same
 * logical request, including across simultaneous races: exactly one INSERT wins, the loser
 * reads back the winner's row under FOR UPDATE and compares digests itself.
 */
export async function beginIdempotentRequest(
  client: pg.PoolClient,
  params: {
    id: string;
    principalWalletId: string;
    operation: string;
    clientKey: string;
    requestDigest: Buffer;
  },
): Promise<BeginIdempotentRequestResult> {
  const inserted = await client.query(
    `INSERT INTO idempotency_keys (id, principal_wallet_id, operation, client_key, request_digest, status)
     VALUES ($1,$2,$3,$4,$5,'IN_PROGRESS')
     ON CONFLICT (principal_wallet_id, operation, client_key) DO NOTHING
     RETURNING *`,
    [params.id, params.principalWalletId, params.operation, params.clientKey, params.requestDigest],
  );
  if (inserted.rows[0]) {
    return { kind: 'created', row: mapRow(inserted.rows[0]) };
  }

  const existing = await client.query(
    `SELECT * FROM idempotency_keys
     WHERE principal_wallet_id = $1 AND operation = $2 AND client_key = $3
     FOR UPDATE`,
    [params.principalWalletId, params.operation, params.clientKey],
  );
  const row = existing.rows[0];
  if (!row) {
    throw new Error(
      'beginIdempotentRequest: ON CONFLICT fired but no existing row found (should be impossible)',
    );
  }
  const mapped = mapRow(row);
  if (!mapped.requestDigest.equals(params.requestDigest)) {
    return { kind: 'conflict', row: mapped };
  }
  return { kind: 'existing', row: mapped };
}

export async function completeIdempotentRequest(
  client: pg.PoolClient,
  params: {
    id: string;
    status: 'COMPLETED' | 'FAILED_RETRYABLE' | 'FAILED_TERMINAL';
    resourceKind?: string;
    resourceId?: string;
    responseStatus?: number;
    responseBody?: unknown;
  },
): Promise<IdempotencyKeyRow> {
  const result = await client.query(
    `UPDATE idempotency_keys
     SET status = $2, resource_kind = COALESCE($3, resource_kind), resource_id = COALESCE($4, resource_id),
         response_status = COALESCE($5, response_status), response_body = COALESCE($6, response_body)
     WHERE id = $1
     RETURNING *`,
    [
      params.id,
      params.status,
      params.resourceKind ?? null,
      params.resourceId ?? null,
      params.responseStatus ?? null,
      params.responseBody !== undefined ? JSON.stringify(params.responseBody) : null,
    ],
  );
  const row = result.rows[0];
  if (!row)
    throw new Error(`completeIdempotentRequest: no idempotency_keys row with id ${params.id}`);
  return mapRow(row);
}
