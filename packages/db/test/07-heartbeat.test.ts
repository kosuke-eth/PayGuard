/**
 * Worker freshness storage (migration 0005). Real-PostgreSQL: upsert, freshest-row selection
 * across multiple worker instances, and graceful-shutdown removal.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { withTransaction } from '../src/pool.js';
import {
  getFreshestHeartbeat,
  recordHeartbeat,
  removeHeartbeat,
} from '../src/repositories/heartbeat.js';
import { createTestVaultChain } from './helpers/fixtures.js';
import { ensureMigrated, getTestPool, truncateAll, uuid } from './helpers/testDb.js';

const pool = getTestPool();

beforeAll(async () => {
  await ensureMigrated(pool);
  await truncateAll(pool);
});

describe('worker_heartbeat', () => {
  it('upserts on repeated calls -- one row per worker_id, last_seen_at advances', async () => {
    const { deployment } = await withTransaction(pool, (client) =>
      createTestVaultChain(client, 'heartbeat-upsert'),
    );
    const workerId = `worker-${uuid()}`;

    const first = await recordHeartbeat(pool, { workerId, deploymentId: deployment.id });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await recordHeartbeat(pool, { workerId, deploymentId: deployment.id });

    expect(second.workerId).toBe(first.workerId);
    expect(second.lastSeenAt.getTime()).toBeGreaterThanOrEqual(first.lastSeenAt.getTime());

    const rowCount = await pool.query(
      'SELECT count(*)::int AS n FROM worker_heartbeat WHERE worker_id = $1',
      [workerId],
    );
    expect(rowCount.rows[0].n).toBe(1);
  });

  it('getFreshestHeartbeat returns the most recently reporting worker for a deployment', async () => {
    const { deployment } = await withTransaction(pool, (client) =>
      createTestVaultChain(client, 'heartbeat-freshest'),
    );
    const stale = `worker-stale-${uuid()}`;
    const fresh = `worker-fresh-${uuid()}`;

    await recordHeartbeat(pool, { workerId: stale, deploymentId: deployment.id });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await recordHeartbeat(pool, { workerId: fresh, deploymentId: deployment.id });

    const freshest = await getFreshestHeartbeat(pool, { deploymentId: deployment.id });
    expect(freshest!.workerId).toBe(fresh);
  });

  it('returns null for a deployment no worker has ever reported for', async () => {
    const { deployment } = await withTransaction(pool, (client) =>
      createTestVaultChain(client, 'heartbeat-none'),
    );
    const freshest = await getFreshestHeartbeat(pool, { deploymentId: deployment.id });
    expect(freshest).toBeNull();
  });

  it('removeHeartbeat deletes the row -- a gracefully-stopped worker reads as absent, not stale', async () => {
    const { deployment } = await withTransaction(pool, (client) =>
      createTestVaultChain(client, 'heartbeat-remove'),
    );
    const workerId = `worker-${uuid()}`;
    await recordHeartbeat(pool, { workerId, deploymentId: deployment.id });
    expect((await getFreshestHeartbeat(pool, { deploymentId: deployment.id }))!.workerId).toBe(
      workerId,
    );

    await withTransaction(pool, (client) => removeHeartbeat(client, workerId));
    expect(await getFreshestHeartbeat(pool, { deploymentId: deployment.id })).toBeNull();
  });
});
