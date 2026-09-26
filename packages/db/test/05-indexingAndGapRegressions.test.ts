import { beforeAll, describe, expect, it } from 'vitest';
import { withTransaction } from '../src/pool.js';
import {
  getEventsByTx,
  getPaymentsAffectedByOrphanedBlocks,
  getPaymentsKeysetForVaults,
  recordBlock,
  recordEvent,
  recordReceipt,
  reorgToBlock,
} from '../src/repositories/indexing.js';
import { createIntentVersion, createPaymentForInvoice } from '../src/repositories/payments.js';
import { recordSignedAttempt, reserveNonceFamily } from '../src/repositories/txJournal.js';
import {
  createTestVaultChain,
  insertTestArtifact,
  insertTestInvoice,
  insertTestPolicy,
} from './helpers/fixtures.js';
import {
  ensureMigrated,
  fakeAddress,
  fakeHash32,
  getTestPool,
  truncateAll,
  uuid,
} from './helpers/testDb.js';

const pool = getTestPool();

beforeAll(async () => {
  await ensureMigrated(pool);
  await truncateAll(pool);
});

describe('canonical/orphan replay storage without duplicate projection', () => {
  it('re-polling the same block/event is idempotent -- no duplicate rows', async () => {
    await withTransaction(pool, async (client) => {
      const { deployment } = await createTestVaultChain(client, 'replay-idempotent');
      const blockHash = fakeHash32('replay-block-1');
      const txHash = fakeHash32('replay-tx-1');

      const first = await recordBlock(client, {
        deploymentId: deployment.id,
        blockHash,
        blockNumber: 10n,
        parentHash: fakeHash32('replay-parent'),
        canonical: true,
        confidence: 'INCLUDED',
      });
      expect(first.kind).toBe('created');

      const firstEvent = await recordEvent(client, {
        deploymentId: deployment.id,
        blockHash,
        logIndex: 0n,
        txHash,
        emitter: fakeAddress('replay-emitter'),
        topic0: fakeHash32('replay-topic0'),
        topics: [],
        data: Buffer.from('aa', 'hex'),
        canonical: true,
      });
      expect(firstEvent.kind).toBe('created');

      // Simulated re-poll of the exact same range.
      const secondBlock = await recordBlock(client, {
        deploymentId: deployment.id,
        blockHash,
        blockNumber: 10n,
        parentHash: fakeHash32('replay-parent'),
        canonical: true,
        confidence: 'INCLUDED',
      });
      expect(secondBlock.kind).toBe('existing');
      const secondEvent = await recordEvent(client, {
        deploymentId: deployment.id,
        blockHash,
        logIndex: 0n,
        txHash,
        emitter: fakeAddress('replay-emitter'),
        topic0: fakeHash32('replay-topic0'),
        topics: [],
        data: Buffer.from('aa', 'hex'),
        canonical: true,
      });
      expect(secondEvent.kind).toBe('existing');

      const events = await getEventsByTx(client, { deploymentId: deployment.id, txHash });
      expect(events).toHaveLength(1); // not duplicated by the re-poll
      const blockCount = await client.query(
        'SELECT count(*)::int AS n FROM chain_blocks WHERE deployment_id=$1 AND block_hash=$2',
        [deployment.id, blockHash],
      );
      expect(blockCount.rows[0].n).toBe(1);
    });
  });

  it('a reorg orphans the old branch and promotes the new one, without creating duplicate rows for either', async () => {
    await withTransaction(pool, async (client) => {
      const { deployment } = await createTestVaultChain(client, 'replay-reorg');
      const blockA = fakeHash32('reorg-block-a');
      const blockB = fakeHash32('reorg-block-b');
      const txA = fakeHash32('reorg-tx-a');
      const txB = fakeHash32('reorg-tx-b');

      await recordBlock(client, {
        deploymentId: deployment.id,
        blockHash: blockA,
        blockNumber: 20n,
        parentHash: fakeHash32('reorg-parent'),
        canonical: true,
        confidence: 'INCLUDED',
      });
      await recordEvent(client, {
        deploymentId: deployment.id,
        blockHash: blockA,
        logIndex: 0n,
        txHash: txA,
        emitter: fakeAddress('reorg-emitter'),
        topic0: fakeHash32('reorg-topic0'),
        topics: [],
        data: Buffer.from('aa', 'hex'),
        canonical: true,
      });

      // The competing block observed later at the same height, initially non-canonical.
      await recordBlock(client, {
        deploymentId: deployment.id,
        blockHash: blockB,
        blockNumber: 20n,
        parentHash: fakeHash32('reorg-parent'),
        canonical: false,
        confidence: 'INCLUDED',
      });
      await recordEvent(client, {
        deploymentId: deployment.id,
        blockHash: blockB,
        logIndex: 0n,
        txHash: txB,
        emitter: fakeAddress('reorg-emitter'),
        topic0: fakeHash32('reorg-topic0'),
        topics: [],
        data: Buffer.from('bb', 'hex'),
        canonical: false,
      });

      await reorgToBlock(client, {
        deploymentId: deployment.id,
        orphanedBlockHashes: [blockA],
        newCanonicalBlockHash: blockB,
      });

      const blocks = await client.query<{ block_hash: Buffer; canonical: boolean }>(
        'SELECT block_hash, canonical FROM chain_blocks WHERE deployment_id = $1 ORDER BY block_hash',
        [deployment.id],
      );
      expect(blocks.rows).toHaveLength(2); // still exactly one row per block -- orphaning is a flag flip, not a delete+reinsert
      const canonicalRow = blocks.rows.find((r) => r.canonical);
      expect(canonicalRow!.block_hash.equals(blockB)).toBe(true);

      const eventsA = await getEventsByTx(client, { deploymentId: deployment.id, txHash: txA });
      const eventsB = await getEventsByTx(client, { deploymentId: deployment.id, txHash: txB });
      expect(eventsA).toHaveLength(1);
      expect(eventsA[0]!.canonical).toBe(false); // orphaned, not deleted -- still queryable as history
      expect(eventsB).toHaveLength(1);
      expect(eventsB[0]!.canonical).toBe(true);
    });
  });
});

describe('getPaymentsAffectedByOrphanedBlocks (Stage 5 review finding 3)', () => {
  it("finds the payment whose winning attempt's receipt lives in an orphaned block", async () => {
    await withTransaction(pool, async (client) => {
      const { deployment, vault } = await createTestVaultChain(client, 'reorg-sweep');
      const policyId = await insertTestPolicy(client, { vaultId: vault.id });
      const artifactId = await insertTestArtifact(client, 'reorg-sweep');
      const invoiceId = await insertTestInvoice(client, {
        vaultId: vault.id,
        artifactId,
        label: 'reorg-sweep',
      });
      const payment = await createPaymentForInvoice(client, {
        id: uuid(),
        vaultId: vault.id,
        invoiceId,
        policyDecision: 'ALLOW',
      });
      const intent = await createIntentVersion(client, {
        id: uuid(),
        paymentId: payment.row.id,
        vaultId: vault.id,
        policyId,
        version: 1n,
        intentDigest: fakeHash32('reorg-sweep-intent'),
        artifactId,
        agentNonce: 1n,
        maxInputAmount: 100n,
        validUntil: 999999999n,
      });
      const family = await reserveNonceFamily(client, {
        id: uuid(),
        deploymentId: deployment.id,
        sender: fakeAddress('reorg-sweep-relayer'),
        intentId: intent.id,
        unsignedRequest: {},
        expectedTo: fakeAddress('to'),
        expectedCalldataHash: fakeHash32('calldata'),
      });
      const txHash = fakeHash32('reorg-sweep-tx');
      const attempt = await recordSignedAttempt(client, {
        id: uuid(),
        deploymentId: deployment.id,
        nonceFamilyId: family.id,
        txHash,
        rawSignedTransaction: Buffer.from('aa', 'hex'),
      });

      const orphanedBlock = fakeHash32('reorg-sweep-block');
      await recordBlock(client, {
        deploymentId: deployment.id,
        blockHash: orphanedBlock,
        blockNumber: 30n,
        parentHash: fakeHash32('reorg-sweep-parent'),
        canonical: true,
        confidence: 'INCLUDED',
      });
      await recordReceipt(client, {
        deploymentId: deployment.id,
        txHash,
        blockHash: orphanedBlock,
        receiptStatus: 1,
        canonical: true,
        rawReceipt: {},
      });

      const affected = await getPaymentsAffectedByOrphanedBlocks(client, {
        deploymentId: deployment.id,
        orphanedBlockHashes: [orphanedBlock],
      });
      expect(affected).toEqual([
        { paymentId: payment.row.id, attemptId: attempt.id, nonceFamilyId: family.id },
      ]);

      // An unrelated block hash must find nothing.
      const unrelated = await getPaymentsAffectedByOrphanedBlocks(client, {
        deploymentId: deployment.id,
        orphanedBlockHashes: [fakeHash32('reorg-sweep-unrelated-block')],
      });
      expect(unrelated).toEqual([]);

      // An empty input list is a no-op, not a query with a degenerate ANY($2) match.
      const empty = await getPaymentsAffectedByOrphanedBlocks(client, {
        deploymentId: deployment.id,
        orphanedBlockHashes: [],
      });
      expect(empty).toEqual([]);
    });
  });
});

describe("deployment reset: a fresh instance never surfaces a prior instance's rows", () => {
  it("a payments query scoped to the new deployment's vault never returns the old deployment's payment", async () => {
    const { vaultOldId, vaultNewId } = await withTransaction(pool, async (client) => {
      const chainOld = await createTestVaultChain(client, 'reset-old');
      const artifactOld = await insertTestArtifact(client, 'reset-old');
      const invoiceOld = await insertTestInvoice(client, {
        vaultId: chainOld.vault.id,
        artifactId: artifactOld,
        label: 'reset-old',
      });
      await createPaymentForInvoice(client, {
        id: uuid(),
        vaultId: chainOld.vault.id,
        invoiceId: invoiceOld,
        policyDecision: 'ALLOW',
      });

      // A fresh local reset: a brand-new deployment/vault, not a mutation of the old one.
      const chainNew = await createTestVaultChain(client, 'reset-new');
      const artifactNew = await insertTestArtifact(client, 'reset-new');
      const invoiceNew = await insertTestInvoice(client, {
        vaultId: chainNew.vault.id,
        artifactId: artifactNew,
        label: 'reset-new',
      });
      await createPaymentForInvoice(client, {
        id: uuid(),
        vaultId: chainNew.vault.id,
        invoiceId: invoiceNew,
        policyDecision: 'ALLOW',
      });

      return { vaultOldId: chainOld.vault.id, vaultNewId: chainNew.vault.id };
    });

    const scopedToNew = await getPaymentsKeysetForVaults(pool, {
      vaultIds: [vaultNewId],
      limit: 50,
    });
    expect(scopedToNew.every((p) => p.vaultId === vaultNewId)).toBe(true);
    expect(scopedToNew.some((p) => p.vaultId === vaultOldId)).toBe(false);

    // The old row still physically exists -- a reset archives/rescopes, it does not delete history.
    const oldStillExists = await pool.query(
      'SELECT count(*)::int AS n FROM payments WHERE vault_id = $1',
      [vaultOldId],
    );
    expect(oldStillExists.rows[0].n).toBe(1);
  });
});

describe('SPEC-004 regression: auth_challenges.session_kind is persisted and required', () => {
  it('accepts a challenge row with a valid session_kind', async () => {
    await withTransaction(pool, async (client) => {
      const { owner } = await createTestVaultChain(client, 'session-kind-ok');
      const id = uuid();
      await client.query(
        `INSERT INTO auth_challenges (id, wallet_id, chain_id, nonce_hash, expected_message, expires_at, session_kind)
         VALUES ($1,$2,31337,$3,'sign this','2099-01-01T00:00:00Z','AGENT')`,
        [id, owner.id, fakeHash32('nonce-session-kind-ok')],
      );
      const read = await client.query('SELECT session_kind FROM auth_challenges WHERE id = $1', [
        id,
      ]);
      expect(read.rows[0].session_kind).toBe('AGENT');
    });
  });

  it('rejects a challenge row with no session_kind at all', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        const { owner } = await createTestVaultChain(client, 'session-kind-missing');
        await client.query(
          `INSERT INTO auth_challenges (id, wallet_id, chain_id, nonce_hash, expected_message, expires_at)
           VALUES ($1,$2,31337,$3,'sign this','2099-01-01T00:00:00Z')`,
          [uuid(), owner.id, fakeHash32('nonce-session-kind-missing')],
        );
      }),
    ).rejects.toThrow(/null value|not-null/i);
  });

  it('rejects a challenge row with an invalid session_kind value', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        const { owner } = await createTestVaultChain(client, 'session-kind-invalid');
        await client.query(
          `INSERT INTO auth_challenges (id, wallet_id, chain_id, nonce_hash, expected_message, expires_at, session_kind)
           VALUES ($1,$2,31337,$3,'sign this','2099-01-01T00:00:00Z','SOMETHING_ELSE')`,
          [uuid(), owner.id, fakeHash32('nonce-session-kind-invalid')],
        );
      }),
    ).rejects.toThrow(/violates check constraint/);
  });
});
