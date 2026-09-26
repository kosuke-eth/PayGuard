/**
 * Durable outbox: work is created in the SAME transaction as the domain write it follows from
 * (`enqueue` takes a client already inside that transaction), claimed with `FOR UPDATE SKIP
 * LOCKED` in a short separate transaction, and completed/retried only by whoever currently holds
 * the lease (owner + fencing version both must match). Prompt 3 item 6: "Release the DB
 * transaction before any external operation" -- claimDueJobs commits and returns; the actual
 * work happens outside any SQL transaction, then completeJob/retryJob run their own short one.
 */
import type pg from 'pg';
import type { Queryable } from '../pool.js';

export type OutboxStatus = 'READY' | 'RUNNING' | 'DONE' | 'DEAD';

export interface OutboxRow {
  id: string;
  eventKey: string;
  aggregateKind: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  availableAt: Date;
  leaseOwner: string | null;
  leaseVersion: bigint;
  lockedUntil: Date | null;
  lastError: string | null;
  createdAt: Date;
}

function mapRow(row: Record<string, unknown>): OutboxRow {
  return {
    id: row.id as string,
    eventKey: row.event_key as string,
    aggregateKind: row.aggregate_kind as string,
    aggregateId: row.aggregate_id as string,
    eventType: row.event_type as string,
    payload: row.payload,
    status: row.status as OutboxStatus,
    attempts: row.attempts as number,
    availableAt: row.available_at as Date,
    leaseOwner: (row.lease_owner as string | null) ?? null,
    leaseVersion: BigInt(row.lease_version as string),
    lockedUntil: (row.locked_until as Date | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

export type EnqueueResult =
  | { kind: 'created'; row: OutboxRow }
  | { kind: 'existing'; row: OutboxRow };

export async function enqueue(
  client: pg.PoolClient,
  params: {
    id: string;
    eventKey: string;
    aggregateKind: string;
    aggregateId: string;
    eventType: string;
    payload: unknown;
  },
): Promise<EnqueueResult> {
  const inserted = await client.query(
    `INSERT INTO outbox (id, event_key, aggregate_kind, aggregate_id, event_type, payload, status)
     VALUES ($1,$2,$3,$4,$5,$6,'READY')
     ON CONFLICT (event_key) DO NOTHING
     RETURNING *`,
    [
      params.id,
      params.eventKey,
      params.aggregateKind,
      params.aggregateId,
      params.eventType,
      JSON.stringify(params.payload),
    ],
  );
  if (inserted.rows[0]) return { kind: 'created', row: mapRow(inserted.rows[0]) };
  const existing = await client.query('SELECT * FROM outbox WHERE event_key = $1', [
    params.eventKey,
  ]);
  const row = existing.rows[0];
  if (!row) throw new Error('enqueue: conflict but no existing row found (race?)');
  return { kind: 'existing', row: mapRow(row) };
}

/**
 * Claims up to `limit` due jobs (READY and due, or RUNNING with an expired lease) in one short
 * transaction, matching DATABASE_SCHEMA.sql's own documented worker claim pattern verbatim.
 */
export async function claimDueJobs(
  pool: pg.Pool,
  params: { leaseOwner: string; leaseDurationSeconds: number; limit: number },
): Promise<OutboxRow[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      const result = await client.query(
        `WITH selected AS (
           SELECT id FROM outbox
           WHERE (status='READY' AND available_at<=now())
              OR (status='RUNNING' AND locked_until<now())
           ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT $1
         )
         UPDATE outbox o SET status='RUNNING',lease_owner=$2,
           lease_version=o.lease_version+1, locked_until=now()+($3 || ' seconds')::interval,
           attempts=o.attempts+1
         FROM selected s WHERE o.id=s.id RETURNING o.*`,
        [params.limit, params.leaseOwner, params.leaseDurationSeconds],
      );
      await client.query('COMMIT');
      return result.rows.map(mapRow);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
  }
}

/** Succeeds only if the caller still holds the lease (owner AND version both match). */
export async function completeJob(
  db: Queryable,
  params: { id: string; leaseOwner: string; expectedLeaseVersion: bigint },
): Promise<{ completed: boolean; row: OutboxRow | null }> {
  const result = await db.query(
    `UPDATE outbox SET status='DONE', locked_until=NULL
     WHERE id=$1 AND lease_owner=$2 AND lease_version=$3
     RETURNING *`,
    [params.id, params.leaseOwner, params.expectedLeaseVersion.toString(10)],
  );
  const row = result.rows[0];
  return { completed: !!row, row: row ? mapRow(row) : null };
}

/**
 * Requeues (or, past `maxAttempts`, kills) a job -- only if the caller still holds the lease.
 * Bounded, classified: `attempts` is already incremented by the claim itself; DEAD is a distinct,
 * visible terminal status from a job that will retry again.
 */
export async function retryJob(
  db: Queryable,
  params: {
    id: string;
    leaseOwner: string;
    expectedLeaseVersion: bigint;
    error: string;
    maxAttempts: number;
    backoffSeconds: number;
  },
): Promise<{ updated: boolean; row: OutboxRow | null }> {
  const result = await db.query(
    `UPDATE outbox SET
       status = CASE WHEN attempts >= $4 THEN 'DEAD' ELSE 'READY' END,
       available_at = CASE WHEN attempts >= $4 THEN available_at ELSE now() + ($5 || ' seconds')::interval END,
       lease_owner = NULL, locked_until = NULL, last_error = $6
     WHERE id=$1 AND lease_owner=$2 AND lease_version=$3
     RETURNING *`,
    [
      params.id,
      params.leaseOwner,
      params.expectedLeaseVersion.toString(10),
      params.maxAttempts,
      params.backoffSeconds,
      params.error,
    ],
  );
  const row = result.rows[0];
  return { updated: !!row, row: row ? mapRow(row) : null };
}

export async function getOutboxById(db: Queryable, id: string): Promise<OutboxRow | null> {
  const result = await db.query('SELECT * FROM outbox WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}
