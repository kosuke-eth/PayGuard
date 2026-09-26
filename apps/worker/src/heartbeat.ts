/**
 * Worker freshness (item 6): one row per running worker instance, upserted on a short interval.
 * `GET /health/ready` reads the freshest row for the configured deployment to decide whether the
 * worker side of the system is actually alive.
 */
import { recordHeartbeat, removeHeartbeat, withTransaction } from '@payguard/db';
import type pg from 'pg';

export async function beatHeartbeat(
  pool: pg.Pool,
  params: { workerId: string; deploymentId: string },
): Promise<void> {
  await recordHeartbeat(pool, params);
}

export async function removeHeartbeatOnShutdown(pool: pg.Pool, workerId: string): Promise<void> {
  await withTransaction(pool, (client) => removeHeartbeat(client, workerId));
}

export function startHeartbeatLoop(
  pool: pg.Pool,
  params: { workerId: string; deploymentId: string; intervalMs: number },
): { stop: () => void } {
  const timer = setInterval(() => {
    beatHeartbeat(pool, params).catch((error) => {
      console.error(
        `heartbeat write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }, params.intervalMs);
  // Fire once immediately so readiness doesn't wait a full interval after boot.
  beatHeartbeat(pool, params).catch((error) => {
    console.error(
      `initial heartbeat write failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  return {
    stop: () => clearInterval(timer),
  };
}
