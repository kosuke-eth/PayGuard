/**
 * Stage 5 wiring of GET /health/ready's `worker` and `relayerBalance` checks: real worker_heartbeat
 * rows against a real Postgres row (recovery-table row 14), and a real on-chain balance read via
 * the harness's real Anvil instance -- not the Stage 4 hardcoded `ok: false` placeholders.
 */
import { recordHeartbeat } from '@payguard/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers/testApp.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
}, 60_000);

afterAll(async () => {
  await harness.stopAnvil();
});

describe('GET /health/ready: worker heartbeat + relayer balance', () => {
  it('reports worker NOT ready when no heartbeat has ever been recorded', async () => {
    const response = await harness.built.app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    const worker = body.data.checks.find((c: { name: string }) => c.name === 'worker');
    expect(worker.ok).toBe(false);
    expect(body.data.readyForPaymentExecution).toBe(false);
  });

  it('reports worker ready with a fresh heartbeat, and overall READY once relayer balance is also funded', async () => {
    await recordHeartbeat(harness.pool, {
      workerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      deploymentId: harness.deploymentId,
    });

    const response = await harness.built.app.inject({ method: 'GET', url: '/health/ready' });
    const body = response.json();
    const worker = body.data.checks.find((c: { name: string }) => c.name === 'worker');
    const relayerBalance = body.data.checks.find(
      (c: { name: string }) => c.name === 'relayerBalance',
    );
    expect(worker.ok).toBe(true);
    // The harness points RELAYER_ADDRESS at the fixture's owner account, which Anvil funds by
    // default -- a real non-zero on-chain balance read, not a mocked value.
    expect(relayerBalance.ok).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(body.data.status).toBe('READY');
    expect(body.data.readyForPaymentExecution).toBe(true);
  });

  it('reports worker NOT ready once the only heartbeat is older than the staleness bound', async () => {
    await harness.pool.query(
      `INSERT INTO worker_heartbeat (worker_id, deployment_id, last_seen_at)
       VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', $1, now() - interval '1 hour')
       ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = now() - interval '1 hour'`,
      [harness.deploymentId],
    );
    // Remove the fresh one from the previous test so the freshest remaining row is the stale one.
    await harness.pool.query(
      "DELETE FROM worker_heartbeat WHERE worker_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'",
    );

    const response = await harness.built.app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    const worker = body.data.checks.find((c: { name: string }) => c.name === 'worker');
    expect(worker.ok).toBe(false);
    expect(worker.detail).toMatch(/exceeds/);
  });
});
