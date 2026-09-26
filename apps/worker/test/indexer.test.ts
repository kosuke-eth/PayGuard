/**
 * Real chain observation/indexing/reorg coverage (item 5) against real Anvil + Postgres: forward
 * `eth_getLogs` indexing with idempotent replay, and a REAL `anvil_reorg` that orphans a settled
 * payment's block, exercising `findCommonAncestorAndOrphans`'s walk-back comparison against our own
 * stored canonical chain -- this is the exact path that was silently broken (see SPEC-032: it
 * always declared the ancestor after exactly one step back, regardless of whether the chain still
 * diverged there, and never accumulated more than the seed orphaned hash) before this test forced a
 * real multi-block reorg through it.
 */
import { randomBytes, randomUUID } from 'node:crypto';
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

  it('SPEC-037: after a reorg orphans a settled attempt, a LATER payment from the SAME relayer still actually settles -- the nonce gap does not stall it forever', async () => {
    const first = await seedAllowedPayment(harness);
    const { jobId: firstJobId } = await seedSubmission(harness, {
      paymentId: first.paymentId,
      intentId: first.intentId,
      ownerWalletId: first.ownerWalletId,
    });
    const submitDeps = submitDepsFor(harness);
    await driveJobToCompletion(harness, submitDeps, firstJobId);
    const firstSettled = await getPaymentById(harness.pool, first.paymentId);
    expect(firstSettled!.executionStatus).toBe('SUCCEEDED');

    const deps = indexerDepsFor(harness);
    await tickUntilCaughtUp(deps);

    // Real reorg orphans the FIRST payment's settlement block -- exactly the SPEC-037
    // precondition: `signer_state.next_nonce` already counted that nonce, but the live chain no
    // longer shows it as mined.
    await anvilReorg(harness.fixture.rpcUrl, 3);
    await tickUntilCaughtUp(deps); // regression + SPEC-037 reconciliation both run inside this tick

    const relayerAddress = submitDeps.signer.address;
    const liveCountAfterReorg = await deps.publicClient.getTransactionCount({
      address: relayerAddress,
      blockTag: 'latest',
    });

    // A SECOND, entirely independent payment from the SAME relayer. Before the SPEC-037 fix, its
    // fresh nonce reservation would sit one nonce ABOVE the gap the reorg left behind and the
    // resulting transaction would stall in the mempool forever (reproduced directly per
    // DECISIONS.md SPEC-037) -- `driveJobToCompletion`'s bounded retry loop would time out with
    // the job stuck, never reaching DONE.
    const second = await seedAllowedPayment(harness);
    const { jobId: secondJobId } = await seedSubmission(harness, {
      paymentId: second.paymentId,
      intentId: second.intentId,
      ownerWalletId: second.ownerWalletId,
    });
    await driveJobToCompletion(harness, submitDeps, secondJobId);

    const secondSettled = await getPaymentById(harness.pool, second.paymentId);
    expect(secondSettled!.executionStatus).toBe('SUCCEEDED');
    expect(secondSettled!.confidence).toBe('LOCAL_DEMO');

    // The gap nonce itself was genuinely refilled (by the reorg tick's own rebroadcast of the
    // first attempt's persisted raw bytes), not silently skipped -- the relayer's live tx count
    // has caught back up to (at least) where it was consuming nonces before the reorg.
    const finalCount = await deps.publicClient.getTransactionCount({
      address: relayerAddress,
      blockTag: 'latest',
    });
    expect(finalCount).toBeGreaterThan(liveCountAfterReorg);
  }, 60_000);

  it('SPEC-037: a nonce gap whose payment is ALREADY canonically settled through a DIFFERENT attempt is refused, not silently reopened (never a second business payment)', async () => {
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

    const deps = indexerDepsFor(harness);
    await tickUntilCaughtUp(deps);

    const family = await harness.pool.query(
      'SELECT id, sender, canonical_tx_hash FROM nonce_families WHERE intent_id = $1',
      [seeded.intentId],
    );
    const familyRow = family.rows[0];
    const sender = familyRow.sender as Buffer;

    // Fabricate the "already settled through a different attempt" precondition directly: a SECOND
    // nonce family + SUCCEEDED attempt for the SAME payment (as a legitimate re-versioning would
    // produce), with a real canonical receipt of its own -- BEFORE the reorg orphans the first one.
    // Reuses an ALREADY-canonical, ALREADY-real chain_blocks row (the settlement's own observed
    // block) rather than fabricating a block at a height that doesn't exist on the live chain --
    // runIndexerTick's own reorg-detection reads `getMaxCanonicalBlock` and re-fetches it by
    // number from the real chain, so a fake height would break detection itself, not just this
    // fixture.
    const otherTxHash = Buffer.from(randomBytes(32));
    const existingBlock = await harness.pool.query(
      'SELECT block_hash FROM chain_blocks WHERE deployment_id = $1 AND canonical = true ORDER BY block_number ASC LIMIT 1',
      [harness.deploymentId],
    );
    const otherBlockHash = existingBlock.rows[0].block_hash as Buffer;
    await harness.pool.query(
      `INSERT INTO receipts (deployment_id, tx_hash, block_hash, receipt_status, canonical, raw_receipt)
       VALUES ($1,$2,$3,1,true,'{}')`,
      [harness.deploymentId, otherTxHash, otherBlockHash],
    );
    const otherFamily = await harness.pool.query(
      `INSERT INTO nonce_families (id, deployment_id, sender, nonce, intent_id, unsigned_request, expected_to, expected_calldata_hash, canonical_tx_hash, closed_at)
       VALUES (gen_random_uuid(),$1,$2,999999,$3,'{}',$4,$5,$6,now()) RETURNING id`,
      [
        harness.deploymentId,
        sender,
        seeded.intentId,
        Buffer.from(harness.fixture.vaultAddress.slice(2), 'hex'),
        Buffer.alloc(32, 1),
        otherTxHash,
      ],
    );
    await harness.pool.query(
      `INSERT INTO transaction_attempts (id, deployment_id, nonce_family_id, tx_hash, raw_signed_transaction, state)
       VALUES (gen_random_uuid(),$1,$2,$3,'\\x02','SUCCEEDED')`,
      [harness.deploymentId, otherFamily.rows[0].id, otherTxHash],
    );

    await anvilReorg(harness.fixture.rpcUrl, 3);
    await tickUntilCaughtUp(deps);

    // The ORIGINAL family must NOT have been reopened -- it stays closed, exactly as reorgToBlock
    // + the SPEC-037 reconciliation left it, since reopening it would risk a second real payment
    // for an invoice that is already correctly settled through the fabricated "other" attempt.
    const afterReorg = await harness.pool.query(
      'SELECT closed_at FROM nonce_families WHERE id = $1',
      [familyRow.id],
    );
    expect(afterReorg.rows[0].closed_at).not.toBeNull();
  }, 45_000);
});
