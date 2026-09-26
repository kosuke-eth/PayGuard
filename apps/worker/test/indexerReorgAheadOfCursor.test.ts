/**
 * SPEC-034 regression, isolated to its OWN Anvil + Postgres harness (deliberately NOT sharing
 * indexer.test.ts's harness): a real `anvil_reorg` that orphans a settlement block the indexer's
 * OWN cursor has NEVER scanned -- `reconcileAttempt` writes that block's canonical row directly,
 * out of band and ahead of the indexer, so before SPEC-034 the indexer's reorg check (anchored
 * only to `cursor.lastCanonicalHash`) never even looked at it. Kept in its own file/harness
 * because a real reorg on a shared harness permanently desyncs the relayer's `signer_state.next_
 * nonce` bookkeeping from the live chain's actual next nonce for any LATER payment from that same
 * relayer (a separate, real gap this test deliberately does not exercise or fix) -- this test is
 * itself the FIRST and ONLY payment/reorg on its harness, so that desync can never contaminate it.
 */

import { randomUUID } from 'node:crypto';
import { createLocalPublicClient } from '@payguard/chain';
import { getCursor, getOutboxById, getPaymentById } from '@payguard/db';
import { RELAYER_PRIVATE_KEY } from '@payguard/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '../src/config.js';
import { type IndexerDeps, runIndexerTick } from '../src/indexer.js';
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
  return createSubmitDeps({ pool: harness.pool, publicClient, config });
}

async function driveJobToCompletion(
  harness: WorkerHarness,
  submitDeps: ReturnType<typeof submitDepsFor>,
  jobId: string,
): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await runOutboxTick({ pool: harness.pool, submitDeps, leaseDurationSeconds: 60 }, randomUUID());
    const job = await getOutboxById(harness.pool, jobId);
    if (job && (job.status === 'DONE' || job.status === 'DEAD')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function indexerDepsFor(harness: WorkerHarness): IndexerDeps {
  const publicClient = createLocalPublicClient({ rpcUrl: harness.fixture.rpcUrl, chainId: 31337 });
  return {
    pool: harness.pool,
    publicClient,
    deploymentId: harness.deploymentId,
    vaultAddress: harness.fixture.vaultAddress,
    startBlock: 0n,
    batchBlocks: 1000n,
  };
}

async function tickUntilCaughtUp(deps: IndexerDeps): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await runIndexerTick(deps);
    const latest = await deps.publicClient.getBlockNumber();
    const cursor = await getCursor(deps.pool, {
      deploymentId: deps.deploymentId,
      contractGroup: 'vault',
    });
    const nextBlock = cursor?.nextBlock ?? deps.startBlock;
    if (nextBlock > latest) return;
  }
}

async function anvilReorg(rpcUrl: string, depth: number): Promise<void> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_reorg', params: [depth, []] }),
  });
  const body = (await response.json()) as { error?: { message: string } };
  if (body.error) throw new Error(`anvil_reorg failed: ${body.error.message}`);
}

describe('runIndexerTick: reorg ahead of the indexer cursor (SPEC-034)', () => {
  it('a real anvil_reorg that orphans a settlement block the indexer has NEVER scanned still regresses the payment', async () => {
    const seeded = await seedAllowedPayment(harness);
    const { jobId } = await seedSubmission(harness, {
      paymentId: seeded.paymentId,
      intentId: seeded.intentId,
      ownerWalletId: seeded.ownerWalletId,
    });
    const submitDeps = submitDepsFor(harness);
    await driveJobToCompletion(harness, submitDeps, jobId);

    const settled = await getPaymentById(harness.pool, seeded.paymentId);
    expect(settled!.executionStatus).toBe('SUCCEEDED');
    expect(settled!.reconciliation).toBe('MATCHED');

    // `reconcileAttempt` already wrote the settlement's block/receipt/events as canonical directly
    // -- deliberately WITHOUT ever running an indexer tick, so the indexer_cursors row for this
    // deployment does not exist yet. Before SPEC-034, the top-of-tick reorg check only looked at
    // `cursor?.lastCanonicalHash`, which is null here, so it would skip detection entirely and
    // leave this exact out-of-band-ahead block's staleness unreachable.
    const cursorNone = await getCursor(harness.pool, {
      deploymentId: harness.deploymentId,
      contractGroup: 'vault',
    });
    expect(cursorNone).toBeNull();

    const settlementBlock = await harness.pool.query(
      'SELECT block_hash FROM receipts r JOIN transaction_attempts ta ON ta.tx_hash = r.tx_hash WHERE r.deployment_id = $1 AND ta.state = $2 ORDER BY ta.created_at DESC LIMIT 1',
      [harness.deploymentId, 'SUCCEEDED'],
    );
    const settlementBlockHash: Buffer = settlementBlock.rows[0].block_hash;

    // Real 3-block-deep reorg discards the settlement block before the indexer ever looks at it.
    await anvilReorg(harness.fixture.rpcUrl, 3);

    const deps = indexerDepsFor(harness);
    await tickUntilCaughtUp(deps); // must detect the out-of-band-ahead divergence on the FIRST tick

    const regressed = await getPaymentById(harness.pool, seeded.paymentId);
    expect(regressed!.executionStatus).toBe('UNKNOWN');
    expect(regressed!.confidence).toBe('UNOBSERVED');
    expect(regressed!.reasonCode).toBe('ORPHANED_BLOCK');
    // SPEC-034: a stale MATCHED verdict from the now-orphaned receipt must not survive the regression.
    expect(regressed!.reconciliation).toBe('NOT_CHECKED');

    const oldBlock = await harness.pool.query(
      'SELECT canonical FROM chain_blocks WHERE deployment_id = $1 AND block_hash = $2',
      [harness.deploymentId, settlementBlockHash],
    );
    expect(oldBlock.rows[0]?.canonical).toBe(false);

    // Forward indexing must continue cleanly afterward -- no stale-canonical collision at the
    // reorged height, no skipped range.
    await tickUntilCaughtUp(deps);
    const cursorAfter = await getCursor(harness.pool, {
      deploymentId: harness.deploymentId,
      contractGroup: 'vault',
    });
    const latest = await deps.publicClient.getBlockNumber();
    expect(cursorAfter!.nextBlock).toBe(latest + 1n);
  }, 45_000);
});
