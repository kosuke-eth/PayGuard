import { beforeAll, describe, expect, it } from 'vitest';
import { withTransaction } from '../src/pool.js';
import {
  claimDueJobs,
  completeJob,
  enqueue,
  getOutboxById,
  retryJob,
} from '../src/repositories/outbox.js';
import {
  createIntentVersion,
  createPaymentForInvoice,
  getActiveIntent,
  getPaymentById,
  updatePaymentState,
} from '../src/repositories/payments.js';
import {
  createTestVaultChain,
  insertTestArtifact,
  insertTestInvoice,
  insertTestPolicy,
} from './helpers/fixtures.js';
import { ensureMigrated, getTestPool, truncateAll, uuid } from './helpers/testDb.js';

const pool = getTestPool();

beforeAll(async () => {
  await ensureMigrated(pool);
  await truncateAll(pool);
});

describe('rollback leaves no orphaned outbox resource', () => {
  it('a transaction that inserts a payment + outbox row then throws leaves neither behind', async () => {
    const { vault, invoiceId } = await withTransaction(pool, async (client) => {
      const chain = await createTestVaultChain(client, 'rollback-setup');
      const artifactId = await insertTestArtifact(client, 'rollback-setup');
      const invId = await insertTestInvoice(client, {
        vaultId: chain.vault.id,
        artifactId,
        label: 'rollback-setup',
      });
      return { vault: chain.vault, invoiceId: invId };
    });

    const paymentId = uuid();
    const eventKey = `rollback-test-${uuid()}`;

    await expect(
      withTransaction(pool, async (client) => {
        const created = await createPaymentForInvoice(client, {
          id: paymentId,
          vaultId: vault.id,
          invoiceId,
          policyDecision: 'ALLOW',
        });
        if (created.kind !== 'created') throw new Error('expected created');
        await enqueue(client, {
          id: uuid(),
          eventKey,
          aggregateKind: 'payment',
          aggregateId: paymentId,
          eventType: 'payment.created',
          payload: { paymentId },
        });
        throw new Error('simulated failure after both inserts, before commit');
      }),
    ).rejects.toThrow('simulated failure');

    const payment = await getPaymentById(pool, paymentId);
    expect(payment).toBeNull();
    const outboxRow = await pool.query('SELECT 1 FROM outbox WHERE event_key = $1', [eventKey]);
    expect(outboxRow.rows).toHaveLength(0);
  });
});

describe('outbox: leased-job crash, reclaim, and fencing', () => {
  it('an expired lease is reclaimed by a new owner; the stale owner can no longer complete or retry it', async () => {
    // lease_owner is a uuid column -- worker identity is a real uuid, not a free-text label.
    const workerA = uuid();
    const workerB = uuid();
    const eventKey = `lease-fencing-${uuid()}`;
    await withTransaction(pool, (client) =>
      enqueue(client, {
        id: uuid(),
        eventKey,
        aggregateKind: 'test',
        aggregateId: uuid(),
        eventType: 'test.event',
        payload: {},
      }),
    );

    const firstClaim = await claimDueJobs(pool, {
      leaseOwner: workerA,
      leaseDurationSeconds: 60,
      limit: 1,
    });
    expect(firstClaim).toHaveLength(1);
    const job = firstClaim[0]!;
    expect(job.leaseOwner).toBe(workerA);
    expect(job.leaseVersion).toBe(1n);

    // Simulate worker-A crashing mid-job: force its lease to look expired.
    await pool.query("UPDATE outbox SET locked_until = now() - interval '1 second' WHERE id = $1", [
      job.id,
    ]);

    const secondClaim = await claimDueJobs(pool, {
      leaseOwner: workerB,
      leaseDurationSeconds: 60,
      limit: 1,
    });
    expect(secondClaim).toHaveLength(1);
    expect(secondClaim[0]!.id).toBe(job.id);
    expect(secondClaim[0]!.leaseOwner).toBe(workerB);
    expect(secondClaim[0]!.leaseVersion).toBe(2n);

    // The stale worker-A, still holding its old (owner, version) pair, cannot complete...
    const staleComplete = await completeJob(pool, {
      id: job.id,
      leaseOwner: workerA,
      expectedLeaseVersion: 1n,
    });
    expect(staleComplete.completed).toBe(false);

    // ...nor retry it out from under worker-B.
    const staleRetry = await retryJob(pool, {
      id: job.id,
      leaseOwner: workerA,
      expectedLeaseVersion: 1n,
      error: 'stale worker attempting to interfere',
      maxAttempts: 5,
      backoffSeconds: 1,
    });
    expect(staleRetry.updated).toBe(false);

    // worker-B, the current lease holder, completes it successfully.
    const realComplete = await completeJob(pool, {
      id: job.id,
      leaseOwner: workerB,
      expectedLeaseVersion: 2n,
    });
    expect(realComplete.completed).toBe(true);
    expect(realComplete.row!.status).toBe('DONE');

    const final = await getOutboxById(pool, job.id);
    expect(final!.status).toBe('DONE');
  });

  it('retryJob is bounded: exceeding maxAttempts marks the job DEAD instead of READY forever', async () => {
    const workerBounded = uuid();
    const eventKey = `lease-bounded-retry-${uuid()}`;
    await withTransaction(pool, (client) =>
      enqueue(client, {
        id: uuid(),
        eventKey,
        aggregateKind: 'test',
        aggregateId: uuid(),
        eventType: 'test.event',
        payload: {},
      }),
    );
    const [job] = await claimDueJobs(pool, {
      leaseOwner: workerBounded,
      leaseDurationSeconds: 60,
      limit: 1,
    });
    // attempts was incremented to 1 by the claim itself; maxAttempts=1 means this failure exhausts it.
    const result = await retryJob(pool, {
      id: job!.id,
      leaseOwner: workerBounded,
      expectedLeaseVersion: job!.leaseVersion,
      error: 'exhausted',
      maxAttempts: 1,
      backoffSeconds: 1,
    });
    expect(result.updated).toBe(true);
    expect(result.row!.status).toBe('DEAD');
  });
});

describe('one logical payment under real concurrent invoice submission', () => {
  it('two independent connections racing createPaymentForInvoice for the same invoice: exactly one payment row exists', async () => {
    const { vault, invoiceId } = await withTransaction(pool, async (client) => {
      const chain = await createTestVaultChain(client, 'concurrent-invoice');
      const artifactId = await insertTestArtifact(client, 'concurrent-invoice');
      const invId = await insertTestInvoice(client, {
        vaultId: chain.vault.id,
        artifactId,
        label: 'concurrent-invoice',
      });
      return { vault: chain.vault, invoiceId: invId };
    });

    const [resultA, resultB] = await Promise.all([
      withTransaction(pool, (client) =>
        createPaymentForInvoice(client, {
          id: uuid(),
          vaultId: vault.id,
          invoiceId,
          policyDecision: 'ALLOW',
        }),
      ),
      withTransaction(pool, (client) =>
        createPaymentForInvoice(client, {
          id: uuid(),
          vaultId: vault.id,
          invoiceId,
          policyDecision: 'ALLOW',
        }),
      ),
    ]);

    const kinds = [resultA.kind, resultB.kind].sort();
    expect(kinds).toEqual(['created', 'existing']);
    expect(resultA.row.id).toBe(resultB.row.id);

    const count = await pool.query(
      'SELECT count(*)::int AS n FROM payments WHERE invoice_id = $1',
      [invoiceId],
    );
    expect(count.rows[0].n).toBe(1);
  });
});

describe('legitimate retry after a resolved failure', () => {
  it('REVERTED -> READY -> a fresh intent version -> SUCCEEDED, with the invoice never permanently blocked', async () => {
    const paymentId = await withTransaction(pool, async (client) => {
      const { vault } = await createTestVaultChain(client, 'retry-after-failure');
      const invoiceArtifactId = await insertTestArtifact(client, 'retry-after-failure-invoice');
      const invoiceId = await insertTestInvoice(client, {
        vaultId: vault.id,
        artifactId: invoiceArtifactId,
        label: 'retry-after-failure',
      });
      const created = await createPaymentForInvoice(client, {
        id: uuid(),
        vaultId: vault.id,
        invoiceId,
        policyDecision: 'ALLOW',
      });
      if (created.kind !== 'created') throw new Error('expected created');

      const policyId = await insertTestPolicy(client, { vaultId: vault.id });
      const intentArtifactId1 = await insertTestArtifact(client, 'retry-after-failure-intent-1');
      await createIntentVersion(client, {
        id: uuid(),
        paymentId: created.row.id,
        vaultId: vault.id,
        policyId,
        version: 1n,
        intentDigest: Buffer.alloc(32, 10),
        artifactId: intentArtifactId1,
        agentNonce: 1n,
        maxInputAmount: 100n,
        validUntil: 999999999n,
      });

      // Walk the chain to a real revert.
      const path: Array<Parameters<typeof updatePaymentState>[1]['next']> = [
        { executionStatus: 'READY' },
        { executionStatus: 'QUEUED' },
        { executionStatus: 'SIGNED' },
        { executionStatus: 'SUBMITTED' },
        { executionStatus: 'INCLUDED' },
        { executionStatus: 'REVERTED' },
      ];
      let current = created.row;
      for (const next of path) {
        const result = await updatePaymentState(client, {
          paymentId: current.id,
          expectedVersion: current.stateVersion,
          current: {
            policyDecision: current.policyDecision,
            executionStatus: current.executionStatus,
            confidence: current.confidence,
            reconciliation: current.reconciliation,
          },
          next,
        });
        if (!result.updated)
          throw new Error(`CAS update unexpectedly failed at ${JSON.stringify(next)}`);
        current = result.row!;
      }
      expect(current.executionStatus).toBe('REVERTED');

      // The invoice is NOT permanently blocked: a fresh attempt is allowed.
      const backToReady = await updatePaymentState(client, {
        paymentId: current.id,
        expectedVersion: current.stateVersion,
        current: {
          policyDecision: current.policyDecision,
          executionStatus: current.executionStatus,
          confidence: current.confidence,
          reconciliation: current.reconciliation,
        },
        next: { executionStatus: 'READY' },
      });
      expect(backToReady.updated).toBe(true);
      current = backToReady.row!;

      // A genuinely new signed intent version for the same payment/invoice.
      const intentArtifactId2 = await insertTestArtifact(client, 'retry-after-failure-intent-2');
      await createIntentVersion(client, {
        id: uuid(),
        paymentId: current.id,
        vaultId: vault.id,
        policyId,
        version: 2n,
        intentDigest: Buffer.alloc(32, 20),
        artifactId: intentArtifactId2,
        agentNonce: 2n,
        maxInputAmount: 100n,
        validUntil: 999999999n,
      });
      const activeIntent = await getActiveIntent(client, current.id);
      expect(activeIntent!.version).toBe(2n);

      // Complete the fresh attempt successfully.
      const successPath: Array<Parameters<typeof updatePaymentState>[1]['next']> = [
        { executionStatus: 'QUEUED' },
        { executionStatus: 'SIGNED' },
        { executionStatus: 'SUBMITTED' },
        { executionStatus: 'INCLUDED' },
        { executionStatus: 'SUCCEEDED' },
      ];
      for (const next of successPath) {
        const result = await updatePaymentState(client, {
          paymentId: current.id,
          expectedVersion: current.stateVersion,
          current: {
            policyDecision: current.policyDecision,
            executionStatus: current.executionStatus,
            confidence: current.confidence,
            reconciliation: current.reconciliation,
          },
          next,
        });
        if (!result.updated)
          throw new Error(`CAS update unexpectedly failed at ${JSON.stringify(next)}`);
        current = result.row!;
      }
      expect(current.executionStatus).toBe('SUCCEEDED');
      return current.id;
    });

    // Still exactly one logical payment for this invoice throughout the whole retry cycle.
    const count = await pool.query('SELECT count(*)::int AS n FROM payments WHERE id = $1', [
      paymentId,
    ]);
    expect(count.rows[0].n).toBe(1);
    const intentVersions = await pool.query(
      'SELECT count(*)::int AS n FROM payment_intents WHERE payment_id = $1',
      [paymentId],
    );
    expect(intentVersions.rows[0].n).toBe(2); // two versions, never a second payment
  });
});
