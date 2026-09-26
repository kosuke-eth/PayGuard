/**
 * Worker freshness storage (migration 0005, Stage 5). One row per running worker process; the
 * worker upserts its own row on a short interval, and `GET /health/ready` reads it to decide
 * whether the worker side of the system is actually alive, not just that the process was started
 * at some point in the past.
 */
import type pg from 'pg';
import type { Queryable } from '../pool.js';

export interface WorkerHeartbeatRow {
  workerId: string;
  deploymentId: string;
  lastSeenAt: Date;
}

function mapRow(row: Record<string, unknown>): WorkerHeartbeatRow {
  return {
    workerId: row.worker_id as string,
    deploymentId: row.deployment_id as string,
    lastSeenAt: row.last_seen_at as Date,
  };
}

/** Idempotent upsert -- the worker calls this on every heartbeat tick, not just once at boot. */
export async function recordHeartbeat(
  db: Queryable,
  params: { workerId: string; deploymentId: string },
): Promise<WorkerHeartbeatRow> {
  const result = await db.query(
    `INSERT INTO worker_heartbeat (worker_id, deployment_id, last_seen_at)
     VALUES ($1,$2,now())
     ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = now(), deployment_id = $2
     RETURNING *`,
    [params.workerId, params.deploymentId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('recordHeartbeat: INSERT ... RETURNING produced no row');
  return mapRow(row);
}

/**
 * The single freshest heartbeat for a deployment -- what `/health/ready` actually needs: "is AT
 * LEAST ONE worker alive for this deployment right now", not an inventory of every worker that
 * ever ran. Returns null if no worker has ever reported in for this deployment.
 */
export async function getFreshestHeartbeat(
  db: Queryable,
  params: { deploymentId: string },
): Promise<WorkerHeartbeatRow | null> {
  const result = await db.query(
    'SELECT * FROM worker_heartbeat WHERE deployment_id = $1 ORDER BY last_seen_at DESC LIMIT 1',
    [params.deploymentId],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

/** Removes a worker's row on graceful shutdown, so a deliberately-stopped worker reads as absent rather than merely stale. */
export async function removeHeartbeat(client: pg.PoolClient, workerId: string): Promise<void> {
  await client.query('DELETE FROM worker_heartbeat WHERE worker_id = $1', [workerId]);
}
