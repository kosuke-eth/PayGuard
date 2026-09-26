/**
 * Real chain observation/indexing/reorg coverage (item 5) against real Anvil + Postgres: forward
 * `eth_getLogs` indexing with idempotent replay, and a REAL `anvil_reorg` that orphans a settled
 * payment's block, exercising `findCommonAncestorAndOrphans`'s walk-back comparison against our own
 * stored canonical chain -- this is the exact path that was silently broken (see SPEC-032: it
 * always declared the ancestor after exactly one step back, regardless of whether the chain still
 * diverged there, and never accumulated more than the seed orphaned hash) before this test forced a
 * real multi-block reorg through it.
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

/**
 * Real bounded catch-up loop, mirroring how main.ts's indexer interval would drain a backlog.
 * Always ticks at least once per call -- the reorg-detection branch inside `runIndexerTick` runs
 * BEFORE its own "nothing new to process" early return, so a caller that skips ticking merely
 * because the cursor already looks caught up (e.g. right after a same-height reorg) would never
 * give that branch a chance to run at all.
 */
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

/** A REAL Anvil chain reorg (`anvil_reorg`): rewinds `depth` blocks and re-mines that many empty ones. */
async function anvilReorg(rpcUrl: string, depth: number): Promise<void> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_reorg', params: [depth, []] }),
  });
  const body = (await response.json()) as { error?: { message: string } };
  if (body.error) throw new Error(`anvil_reorg failed: ${body.error.message}`);
}

describe('runIndexerTick: forward observation', () => {
  it('indexes real on-chain events canonically, and a full replay from the start is a pure no-op (dedup)', async () => {
    await seedAllowedPayment(harness); // real policy creation + deposit -> real PolicyCreated/Transfer/Approval logs
    const deps = indexerDepsFor(harness);
    await tickUntilCaughtUp(deps);

    const cursor = await getCursor(harness.pool, {
      deploymentId: harness.deploymentId,
      contractGroup: 'vault',
    });
    expect(cursor).not.toBeNull();
    expect(cursor!.lastCanonicalHash).not.toBeNull();

    const blocksBefore = await harness.pool.query(
      'SELECT count(*)::int AS n FROM chain_blocks WHERE deployment_id = $1',
      [harness.deploymentId],
    );
    const eventsBefore = await harness.pool.query(
      'SELECT count(*)::int AS n FROM chain_events WHERE deployment_id = $1',
      [harness.deploymentId],
    );
    expect(eventsBefore.rows[0].n).toBeGreaterThan(0);

    // Force a full replay of the exact same already-indexed range (as if a fresh worker resumed
    // from a stale/reset cursor) -- recordBlock/recordEvent's ON CONFLICT DO NOTHING must dedup
    // cleanly rather than erroring or double-counting.
    await harness.pool.query(
      'UPDATE indexer_cursors SET next_block = $2, last_canonical_hash = NULL WHERE deployment_id = $1 AND contract_group = $3',
      [harness.deploymentId, deps.startBlock.toString(10), 'vault'],
    );
    await tickUntilCaughtUp(deps);

    const blocksAfter = await harness.pool.query(
      'SELECT count(*)::int AS n FROM chain_blocks WHERE deployment_id = $1',
      [harness.deploymentId],
    );
    const eventsAfter = await harness.pool.query(
      'SELECT count(*)::int AS n FROM chain_events WHERE deployment_id = $1',
      [harness.deploymentId],
    );
    expect(blocksAfter.rows[0].n).toBe(blocksBefore.rows[0].n);
    expect(eventsAfter.rows[0].n).toBe(eventsBefore.rows[0].n);
  }, 30_000);
});

describe('runIndexerTick: real reorg regression', () => {
  it('a real anvil_reorg that orphans a settled payment’s block walks back to the true ancestor and regresses the payment to UNKNOWN', async () => {
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
    expect(settled!.confidence).toBe('LOCAL_DEMO');

    const deps = indexerDepsFor(harness);
    await tickUntilCaughtUp(deps); // cursor now points at the settlement block as canonical tip

    const cursorBefore = await getCursor(harness.pool, {
      deploymentId: harness.deploymentId,
      contractGroup: 'vault',
    });
    expect(cursorBefore!.lastCanonicalHash).not.toBeNull();

    // Real 3-block-deep reorg: the settlement transaction's block (and its receipt/events) is
    // discarded from the canonical chain and replaced by new, empty blocks at the same heights.
    await anvilReorg(harness.fixture.rpcUrl, 3);

    await tickUntilCaughtUp(deps); // must detect the divergence, walk back to the true ancestor, regress

    const regressed = await getPaymentById(harness.pool, seeded.paymentId);
    expect(regressed!.executionStatus).toBe('UNKNOWN');
    expect(regressed!.confidence).toBe('UNOBSERVED');
    expect(regressed!.reasonCode).toBe('ORPHANED_BLOCK');

    // The old settlement block itself must now be recorded non-canonical, not merely un-cursored.
    const oldBlock = await harness.pool.query(
      'SELECT canonical FROM chain_blocks WHERE deployment_id = $1 AND block_hash = $2',
      [harness.deploymentId, cursorBefore!.lastCanonicalHash],
    );
    expect(oldBlock.rows[0]?.canonical).toBe(false);

    // The cursor must have resumed from the TRUE common ancestor (a block that still matches the
    // live chain), not from a fabricated one -- the exact bug this test targets.
    const cursorAfter = await getCursor(harness.pool, {
      deploymentId: harness.deploymentId,
      contractGroup: 'vault',
    });
    const ancestorOnChain = await deps.publicClient.getBlock({
      blockNumber: cursorAfter!.nextBlock - 1n,
    });
    expect(`0x${cursorAfter!.lastCanonicalHash!.toString('hex')}`.toLowerCase()).toBe(
      ancestorOnChain.hash.toLowerCase(),
    );
  }, 45_000);
});
