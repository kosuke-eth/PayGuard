import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTransaction } from '../src/pool.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
} from '../src/repositories/idempotency.js';
import {
  completeSingleTransactionOperation,
  createOperation,
  updateOperationStep,
} from '../src/repositories/operations.js';
import {
  createPaymentForInvoice,
  getPaymentById,
  InvalidStateTransitionError,
  updatePaymentState,
} from '../src/repositories/payments.js';
import { createTestVaultChain, insertTestArtifact, insertTestInvoice } from './helpers/fixtures.js';
import { ensureMigrated, getTestPool, truncateAll, uuid } from './helpers/testDb.js';

const pool = getTestPool();

beforeAll(async () => {
  await ensureMigrated(pool);
  await truncateAll(pool);
});

function digest(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}

describe('payments state compare-and-set', () => {
  it('a stale expectedVersion is rejected (no rows updated) while a fresh one succeeds', async () => {
    await withTransaction(pool, async (client) => {
      const { vault } = await createTestVaultChain(client, 'cas-stale');
      const artifactId = await insertTestArtifact(client, 'cas-stale');
      const invoiceId = await insertTestInvoice(client, {
        vaultId: vault.id,
        artifactId,
        label: 'cas-stale',
      });
      const created = await createPaymentForInvoice(client, {
        id: uuid(),
        vaultId: vault.id,
        invoiceId,
        policyDecision: 'ALLOW',
      });
      if (created.kind !== 'created') throw new Error('expected created');
      const payment = created.row;
      expect(payment.stateVersion).toBe(1n);

      const first = await updatePaymentState(client, {
        paymentId: payment.id,
        expectedVersion: 1n,
        current: {
          policyDecision: payment.policyDecision,
          executionStatus: payment.executionStatus,
          confidence: payment.confidence,
          reconciliation: payment.reconciliation,
        },
        next: { executionStatus: 'READY' },
      });
      expect(first.updated).toBe(true);
      expect(first.row!.stateVersion).toBe(2n);

      // Second caller still thinks the version is 1 (stale read) -- must be rejected, not overwrite.
      const second = await updatePaymentState(client, {
        paymentId: payment.id,
        expectedVersion: 1n,
        current: {
          policyDecision: 'ALLOW',
          executionStatus: 'DRAFT',
          confidence: 'UNOBSERVED',
          reconciliation: 'NOT_CHECKED',
        },
        next: { executionStatus: 'READY' }, // legal from the stale DRAFT view it read; must still lose on the version check
      });
      expect(second.updated).toBe(false);
      expect(second.row).toBeNull();

      const current = await getPaymentById(client, payment.id);
      expect(current!.executionStatus).toBe('READY'); // the stale attempt never took effect
    });
  });

  it('two real concurrent connections racing the same CAS update: exactly one wins', async () => {
    const { paymentId } = await withTransaction(pool, async (client) => {
      const { vault } = await createTestVaultChain(client, 'cas-concurrent');
      const artifactId = await insertTestArtifact(client, 'cas-concurrent');
      const invoiceId = await insertTestInvoice(client, {
        vaultId: vault.id,
        artifactId,
        label: 'cas-concurrent',
      });
      const created = await createPaymentForInvoice(client, {
        id: uuid(),
        vaultId: vault.id,
        invoiceId,
        policyDecision: 'ALLOW',
      });
      if (created.kind !== 'created') throw new Error('expected created');
      return { paymentId: created.row.id };
    });

    const clientA = await pool.connect();
    const clientB = await pool.connect();
    try {
      const attempt = (client: typeof clientA) =>
        updatePaymentState(client, {
          paymentId,
          expectedVersion: 1n,
          current: {
            policyDecision: 'ALLOW',
            executionStatus: 'DRAFT',
            confidence: 'UNOBSERVED',
            reconciliation: 'NOT_CHECKED',
          },
          next: { executionStatus: 'READY' },
        });
      const [resultA, resultB] = await Promise.all([attempt(clientA), attempt(clientB)]);
      const updatedCount = [resultA.updated, resultB.updated].filter(Boolean).length;
      expect(updatedCount).toBe(1);
    } finally {
      clientA.release();
      clientB.release();
    }
  });

  it('rejects an illegal transition before ever issuing the UPDATE', async () => {
    await withTransaction(pool, async (client) => {
      const { vault } = await createTestVaultChain(client, 'cas-illegal');
      const artifactId = await insertTestArtifact(client, 'cas-illegal');
      const invoiceId = await insertTestInvoice(client, {
        vaultId: vault.id,
        artifactId,
        label: 'cas-illegal',
      });
      const created = await createPaymentForInvoice(client, {
        id: uuid(),
        vaultId: vault.id,
        invoiceId,
        policyDecision: 'ALLOW',
      });
      if (created.kind !== 'created') throw new Error('expected created');
      const payment = created.row;

      await expect(
        updatePaymentState(client, {
          paymentId: payment.id,
          expectedVersion: 1n,
          current: {
            policyDecision: payment.policyDecision,
            executionStatus: payment.executionStatus,
            confidence: payment.confidence,
            reconciliation: payment.reconciliation,
          },
          next: { executionStatus: 'SUCCEEDED' }, // DRAFT -> SUCCEEDED is not a legal jump
        }),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);

      const unchanged = await getPaymentById(client, payment.id);
      expect(unchanged!.executionStatus).toBe('DRAFT');
      expect(unchanged!.stateVersion).toBe(1n); // the rejected attempt never touched the row
    });
  });
});

describe('idempotency', () => {
  it('simultaneous same-key/same-body: exactly one created, the other sees existing with the same digest', async () => {
    const principalWalletId = await withTransaction(pool, async (client) => {
      const { owner } = await createTestVaultChain(client, 'idem-same-same');
      return owner.id;
    });
    const key = `idem-same-same-${uuid()}`;
    const requestDigest = digest('canonical-request-body-v1');

    // Two independent, self-committing transactions racing the same key: whichever INSERT loses
    // the unique-index race blocks briefly (Postgres serializes on the conflicting row) until the
    // winner commits, then reads the winner back under FOR UPDATE -- no manual BEGIN/COMMIT
    // interleaving needed, and no risk of deadlocking this test on itself.
    const [resultA, resultB] = await Promise.all([
      withTransaction(pool, (client) =>
        beginIdempotentRequest(client, {
          id: uuid(),
          principalWalletId,
          operation: 'test.op',
          clientKey: key,
          requestDigest,
        }),
      ),
      withTransaction(pool, (client) =>
        beginIdempotentRequest(client, {
          id: uuid(),
          principalWalletId,
          operation: 'test.op',
          clientKey: key,
          requestDigest,
        }),
      ),
    ]);

    const kinds = [resultA.kind, resultB.kind].sort();
    expect(kinds).toEqual(['created', 'existing']);
    expect(resultA.row.requestDigest.equals(requestDigest)).toBe(true);
    expect(resultB.row.requestDigest.equals(requestDigest)).toBe(true);
  });

  it('same-key/different-body: the second caller gets a conflict', async () => {
    await withTransaction(pool, async (client) => {
      const { owner } = await createTestVaultChain(client, 'idem-same-diff');
      const key = `idem-same-diff-${uuid()}`;
      const first = await beginIdempotentRequest(client, {
        id: uuid(),
        principalWalletId: owner.id,
        operation: 'test.op',
        clientKey: key,
        requestDigest: digest('body-A'),
      });
      expect(first.kind).toBe('created');

      const second = await beginIdempotentRequest(client, {
        id: uuid(),
        principalWalletId: owner.id,
        operation: 'test.op',
        clientKey: key,
        requestDigest: digest('body-B'),
      });
      expect(second.kind).toBe('conflict');
    });
  });

  it('different-key/same-invoice: idempotency layer allows both, but the invoice-payment uniqueness rule still applies underneath', async () => {
    await withTransaction(pool, async (client) => {
      const { vault, owner } = await createTestVaultChain(client, 'idem-diff-key-same-invoice');
      const artifactId = await insertTestArtifact(client, 'idem-diff-key-same-invoice');
      const invoiceId = await insertTestInvoice(client, {
        vaultId: vault.id,
        artifactId,
        label: 'idem-diff-key',
      });

      const beginA = await beginIdempotentRequest(client, {
        id: uuid(),
        principalWalletId: owner.id,
        operation: 'payment-intents.create',
        clientKey: `key-a-${uuid()}`,
        requestDigest: digest('same-invoice-request'),
      });
      const beginB = await beginIdempotentRequest(client, {
        id: uuid(),
        principalWalletId: owner.id,
        operation: 'payment-intents.create',
        clientKey: `key-b-${uuid()}`,
        requestDigest: digest('same-invoice-request'),
      });
      expect(beginA.kind).toBe('created');
      expect(beginB.kind).toBe('created'); // different keys -- idempotency layer sees two distinct requests

      const paymentA = await createPaymentForInvoice(client, {
        id: uuid(),
        vaultId: vault.id,
        invoiceId,
        policyDecision: 'ALLOW',
      });
      const paymentB = await createPaymentForInvoice(client, {
        id: uuid(),
        vaultId: vault.id,
        invoiceId,
        policyDecision: 'ALLOW',
      });
      expect(paymentA.kind).toBe('created');
      expect(paymentB.kind).toBe('existing'); // the DB-level invoice uniqueness rule still wins
      expect(paymentB.row.id).toBe(paymentA.row.id);
    });
  });

  it('response loss after commit: retrying the same key returns the original stored result', async () => {
    const principalWalletId = await withTransaction(pool, async (client) => {
      const { owner } = await createTestVaultChain(client, 'idem-response-loss');
      return owner.id;
    });
    const key = `idem-response-loss-${uuid()}`;
    const requestDigest = digest('response-loss-body');
    const resourceId = uuid();

    await withTransaction(pool, async (client) => {
      const begin = await beginIdempotentRequest(client, {
        id: uuid(),
        principalWalletId,
        operation: 'test.op',
        clientKey: key,
        requestDigest,
      });
      if (begin.kind !== 'created') throw new Error('expected created');
      await completeIdempotentRequest(client, {
        id: begin.row.id,
        status: 'COMPLETED',
        resourceKind: 'payment',
        resourceId,
        responseStatus: 201,
        responseBody: { paymentId: resourceId },
      });
    });
    // Client never saw the response (simulated) -- retries with the same key.
    await withTransaction(pool, async (client) => {
      const retry = await beginIdempotentRequest(client, {
        id: uuid(),
        principalWalletId,
        operation: 'test.op',
        clientKey: key,
        requestDigest,
      });
      expect(retry.kind).toBe('existing');
      expect(retry.row.status).toBe('COMPLETED');
      expect(retry.row.resourceId).toBe(resourceId);
      expect(retry.row.responseStatus).toBe(201);
    });
  });

  it('failure before commit: a rolled-back begin leaves no logical command, so the same key is retryable as new', async () => {
    const principalWalletId = await withTransaction(pool, async (client) => {
      const { owner } = await createTestVaultChain(client, 'idem-failure-before-commit');
      return owner.id;
    });
    const key = `idem-failure-before-commit-${uuid()}`;
    const requestDigest = digest('failure-before-commit-body');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const begin = await beginIdempotentRequest(client, {
        id: uuid(),
        principalWalletId,
        operation: 'test.op',
        clientKey: key,
        requestDigest,
      });
      expect(begin.kind).toBe('created');
      await client.query('ROLLBACK'); // simulated crash before commit
    } finally {
      client.release();
    }

    await withTransaction(pool, async (freshClient) => {
      const retry = await beginIdempotentRequest(freshClient, {
        id: uuid(),
        principalWalletId,
        operation: 'test.op',
        clientKey: key,
        requestDigest,
      });
      expect(retry.kind).toBe('created'); // not 'existing' -- the rolled-back attempt never committed
    });
  });

  it('deployment reset boundary: the same wallet/operation/key against a new deployment digest is a conflict, not a silent cross-deployment hit', async () => {
    const principalWalletId = await withTransaction(pool, async (client) => {
      const { owner } = await createTestVaultChain(client, 'idem-reset-boundary');
      return owner.id;
    });
    const key = `idem-reset-boundary-${uuid()}`;

    await withTransaction(pool, async (client) => {
      const chainOld = await createTestVaultChain(client, 'idem-reset-old');
      const digestOld = digest(`vault:${chainOld.vault.id}`);
      const begin = await beginIdempotentRequest(client, {
        id: uuid(),
        principalWalletId,
        operation: 'vault.deposit',
        clientKey: key,
        requestDigest: digestOld,
      });
      expect(begin.kind).toBe('created');
    });

    await withTransaction(pool, async (client) => {
      const chainNew = await createTestVaultChain(client, 'idem-reset-new');
      const digestNew = digest(`vault:${chainNew.vault.id}`); // a genuinely different vault/deployment -> different canonical digest
      const reused = await beginIdempotentRequest(client, {
        id: uuid(),
        principalWalletId,
        operation: 'vault.deposit',
        clientKey: key,
        requestDigest: digestNew,
      });
      expect(reused.kind).toBe('conflict'); // never silently treated as "the same request" across deployments
    });
  });
});

describe('operations: multi-step completion (SPEC-006)', () => {
  it('reaches COMPLETED only on the final step; an intermediate APPROVE success leaves it IN_PROGRESS', async () => {
    await withTransaction(pool, async (client) => {
      const { vault, deployment, owner } = await createTestVaultChain(client, 'ops-multistep');
      const op = await createOperation(client, {
        id: uuid(),
        principalWalletId: owner.id,
        deploymentId: deployment.id,
        operationKind: 'DEPOSIT',
        resourceKind: 'vault',
        resourceId: vault.id,
        immutableRequest: Buffer.from('req'),
        requestDigest: Buffer.alloc(32, 1),
        stepKinds: ['APPROVE', 'DEPOSIT'],
      });
      expect(op.status).toBe('QUEUED');
      expect(op.transactionHash).toBeNull();

      const afterApprove = await updateOperationStep(client, {
        operationId: op.id,
        expectedVersion: op.stateVersion,
        currentStatus: op.status,
        currentSteps: op.result!.steps,
        stepIndex: 0,
        stepStatus: 'SUCCEEDED',
        transactionHash: Buffer.alloc(32, 2),
      });
      expect(afterApprove.updated).toBe(true);
      expect(afterApprove.row!.status).toBe('IN_PROGRESS'); // NOT completed -- approval alone is not deposit completion
      expect(afterApprove.row!.transactionHash).toBeNull(); // top-level column stays untouched for multi-step ops
      expect(afterApprove.row!.result!.steps[0]!.status).toBe('SUCCEEDED');
      expect(afterApprove.row!.result!.steps[1]!.status).toBe('PENDING');

      const afterDeposit = await updateOperationStep(client, {
        operationId: op.id,
        expectedVersion: afterApprove.row!.stateVersion,
        currentStatus: afterApprove.row!.status,
        currentSteps: afterApprove.row!.result!.steps,
        stepIndex: 1,
        stepStatus: 'SUCCEEDED',
        transactionHash: Buffer.alloc(32, 3),
      });
      expect(afterDeposit.row!.status).toBe('COMPLETED');
      expect(afterDeposit.row!.transactionHash).toBeNull(); // still NULL -- per-step hash lives in result.steps only
      expect(afterDeposit.row!.result!.steps[1]!.transactionHash).not.toBeNull();
    });
  });

  it('a failed step marks the whole operation FAILED, not COMPLETED', async () => {
    await withTransaction(pool, async (client) => {
      const { vault, deployment, owner } = await createTestVaultChain(client, 'ops-multistep-fail');
      const op = await createOperation(client, {
        id: uuid(),
        principalWalletId: owner.id,
        deploymentId: deployment.id,
        operationKind: 'DEPOSIT',
        resourceKind: 'vault',
        resourceId: vault.id,
        immutableRequest: Buffer.from('req'),
        requestDigest: Buffer.alloc(32, 4),
        stepKinds: ['APPROVE', 'DEPOSIT'],
      });
      const afterFail = await updateOperationStep(client, {
        operationId: op.id,
        expectedVersion: op.stateVersion,
        currentStatus: op.status,
        currentSteps: op.result!.steps,
        stepIndex: 0,
        stepStatus: 'FAILED',
      });
      expect(afterFail.row!.status).toBe('FAILED');
    });
  });

  it('single-transaction operations use the top-level transaction_hash column, not a steps array', async () => {
    await withTransaction(pool, async (client) => {
      const { vault, deployment, owner } = await createTestVaultChain(client, 'ops-single-tx');
      const op = await createOperation(client, {
        id: uuid(),
        principalWalletId: owner.id,
        deploymentId: deployment.id,
        operationKind: 'REVOKE_AGENT',
        resourceKind: 'vault',
        resourceId: vault.id,
        immutableRequest: Buffer.from('req'),
        requestDigest: Buffer.alloc(32, 5),
      });
      expect(op.result).toBeNull();

      const inProgress = await completeSingleTransactionOperation(client, {
        operationId: op.id,
        expectedVersion: op.stateVersion,
        currentStatus: op.status,
        status: 'IN_PROGRESS',
      });
      expect(inProgress.updated).toBe(true);

      const completed = await completeSingleTransactionOperation(client, {
        operationId: op.id,
        expectedVersion: inProgress.row!.stateVersion,
        currentStatus: inProgress.row!.status,
        status: 'COMPLETED',
        transactionHash: Buffer.alloc(32, 6),
      });
      expect(completed.row!.status).toBe('COMPLETED');
      expect(completed.row!.transactionHash).not.toBeNull();
    });
  });
});
