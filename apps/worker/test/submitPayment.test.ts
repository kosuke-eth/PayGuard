/**
 * Full real path: HTTP-shaped fixture data -> SQL -> a locally mined `executePayment` transaction
 * -> receipt-backed payment state, driven entirely through the worker's own `runOutboxTick`
 * (real `claimDueJobs` lease + dispatch + retry/complete) against a real deployed vault, real
 * Postgres, and real Anvil. This is the direct-payment ALLOW demonstration required by the
 * Stage 5 instruction's item 7, exercised as an integration test.
 */
import { randomUUID } from 'node:crypto';
import { createLocalPublicClient } from '@payguard/chain';
import { getOperationById, getOutboxById, getPaymentById } from '@payguard/db';
import { RELAYER_PRIVATE_KEY } from '@payguard/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '../src/config.js';
import { runOutboxTick } from '../src/outboxLoop.js';
import { createSubmitDeps } from '../src/submitPayment.js';
import {
  createWorkerHarness,
  seedAllowedPayment,
  seedSubmission,
  type WorkerHarness,
} from './helpers/paymentFixture.js';

let harness: WorkerHarness;

beforeAll(async () => {
  harness = await createWorkerHarness();
}, 60_000);

afterAll(async () => {
  await harness.stopAnvil();
});

function submitDepsFor(harness: WorkerHarness) {
  const config = loadWorkerConfig({
    DATABASE_URL: 'unused',
    RPC_URL: harness.fixture.rpcUrl,
    CHAIN_ID: '31337',
    PAYGUARD_DEPLOYMENT_ID: harness.deploymentId,
    RELAYER_PRIVATE_KEY,
    WORKER_RECEIPT_POLL_ATTEMPTS: '10',
    WORKER_RECEIPT_POLL_INTERVAL_MS: '200',
  });
  const publicClient = createLocalPublicClient({ rpcUrl: harness.fixture.rpcUrl, chainId: 31337 });
  return { submitDeps: createSubmitDeps({ pool: harness.pool, publicClient, config }), config };
}

/** Drives runOutboxTick until the named job reaches a terminal outbox status (or the bound expires. */
async function driveJobToCompletion(
  harness: WorkerHarness,
  submitDeps: ReturnType<typeof submitDepsFor>['submitDeps'],
  jobId: string,
  workerId: string,
): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await runOutboxTick({ pool: harness.pool, submitDeps, leaseDurationSeconds: 60 }, workerId);
    const job = await getOutboxById(harness.pool, jobId);
    if (job && (job.status === 'DONE' || job.status === 'DEAD')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('runOutboxTick -> handlePaymentSubmissionJob: real ALLOW direct-transfer settlement', () => {
  it('signs, broadcasts, mines, and reconciles a real executePayment -- merchant balance moves exactly outputAmount', async () => {
    const seeded = await seedAllowedPayment(harness);
    const { operationId, jobId } = await seedSubmission(harness, {
      paymentId: seeded.paymentId,
      intentId: seeded.intentId,
      ownerWalletId: seeded.ownerWalletId,
    });

    const balanceBefore = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;

    const { submitDeps } = submitDepsFor(harness);
    await driveJobToCompletion(harness, submitDeps, jobId, randomUUID());

    const payment = await getPaymentById(harness.pool, seeded.paymentId);
    expect(payment!.executionStatus).toBe('SUCCEEDED');
    expect(payment!.confidence).toBe('LOCAL_DEMO');
    expect(payment!.reconciliation).toBe('MATCHED');

    const operation = await getOperationById(harness.pool, operationId);
    expect(operation!.status).toBe('COMPLETED');
    expect(operation!.transactionHash).not.toBeNull();

    const job = await getOutboxById(harness.pool, jobId);
    expect(job!.status).toBe('DONE');

    const balanceAfter = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;
    expect(balanceAfter - balanceBefore).toBe(1_000_000n);
  }, 30_000);

  it('a redelivered claim for an ALREADY-settled payment never pays twice', async () => {
    const seeded = await seedAllowedPayment(harness);
    const { operationId, jobId } = await seedSubmission(harness, {
      paymentId: seeded.paymentId,
      intentId: seeded.intentId,
      ownerWalletId: seeded.ownerWalletId,
    });

    const { submitDeps } = submitDepsFor(harness);
    await driveJobToCompletion(harness, submitDeps, jobId, randomUUID());
    const settled = await getPaymentById(harness.pool, seeded.paymentId);
    expect(settled!.executionStatus).toBe('SUCCEEDED');

    // Force the completed job back to a claimable state, simulating a stale-lease reclaim of a
    // job whose result already landed -- the handler must re-derive "already settled" from
    // persisted state (the vault rejects the now-consumed invoice) rather than re-signing.
    await harness.pool.query(
      "UPDATE outbox SET status='READY', lease_owner=NULL, locked_until=NULL WHERE id = $1",
      [jobId],
    );
    await driveJobToCompletion(harness, submitDeps, jobId, randomUUID());

    const payment = await getPaymentById(harness.pool, seeded.paymentId);
    // Still SUCCEEDED -- a second consumed-invoice rejection must never regress a settled payment.
    expect(payment!.executionStatus).toBe('SUCCEEDED');
    const operation = await getOperationById(harness.pool, operationId);
    expect(operation!.status).toBe('COMPLETED');
  }, 30_000);
});
