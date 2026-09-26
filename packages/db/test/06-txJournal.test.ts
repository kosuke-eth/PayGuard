import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTransaction } from '../src/pool.js';
import { createIntentVersion } from '../src/repositories/payments.js';
import {
  attachCanonicalReceipt,
  getNonceFamilyById,
  getTransactionAttemptByHash,
  InvalidTransactionAttemptStateTransitionError,
  lockSigner,
  markBroadcast,
  markSiblingAttemptsReplaced,
  recordFeeReplacement,
  recordSignedAttempt,
  recoverUnsignedFamilies,
  reserveNonceFamily,
} from '../src/repositories/txJournal.js';
import {
  createTestVaultChain,
  insertTestArtifact,
  insertTestInvoice,
  insertTestPayment,
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

/** Builds a full deployment -> vault -> policy -> artifact -> invoice -> payment -> intent chain,
 * since nonce_families.intent_id REFERENCES payment_intents(id) -- the shortest real FK path to a
 * usable intent id for these tests. */
async function createTestIntent(client: Parameters<typeof createTestVaultChain>[0], label: string) {
  const { deployment, vault } = await createTestVaultChain(client, label);
  const policyId = await insertTestPolicy(client, { vaultId: vault.id });
  const artifactId = await insertTestArtifact(client, label);
  const invoiceId = await insertTestInvoice(client, { vaultId: vault.id, artifactId, label });
  const paymentId = await insertTestPayment(client, { vaultId: vault.id, invoiceId });
  const intent = await createIntentVersion(client, {
    id: uuid(),
    paymentId,
    vaultId: vault.id,
    policyId,
    version: 1n,
    intentDigest: fakeHash32(`intent-${label}-${uuid()}`),
    artifactId,
    agentNonce: 1n,
    maxInputAmount: 100n,
    validUntil: 999999999n,
  });
  return { deployment, vault, intentId: intent.id };
}

describe('reserveNonceFamily', () => {
  it('sequential reservations for the same sender allocate strictly increasing nonces', async () => {
    await withTransaction(pool, async (client) => {
      const { deployment } = await createTestIntent(client, 'nonce-seq');
      const sender = fakeAddress('nonce-seq-sender');

      const families = [];
      for (let i = 0; i < 3; i++) {
        const { intentId } = await createTestIntent(client, `nonce-seq-${i}`);
        families.push(
          await reserveNonceFamily(client, {
            id: uuid(),
            deploymentId: deployment.id,
            sender,
            intentId,
            unsignedRequest: { i },
            expectedTo: fakeAddress('to'),
            expectedCalldataHash: fakeHash32('calldata'),
          }),
        );
      }
      expect(families.map((f) => f.nonce)).toEqual([0n, 1n, 2n]);
    });
  });

  it('two real concurrent connections reserving for the same sender never collide on a nonce', async () => {
    const { deploymentId, sender, intentA, intentB } = await withTransaction(
      pool,
      async (client) => {
        const { deployment } = await createTestIntent(client, 'nonce-race-base');
        const a = await createTestIntent(client, 'nonce-race-a');
        const b = await createTestIntent(client, 'nonce-race-b');
        return {
          deploymentId: deployment.id,
          sender: fakeAddress('nonce-race-sender'),
          intentA: a.intentId,
          intentB: b.intentId,
        };
      },
    );

    const clientA = await pool.connect();
    const clientB = await pool.connect();
    try {
      // reserveNonceFamily issues multiple statements relying on its own SELECT ... FOR UPDATE
      // lock to serialize with a concurrent caller -- that only holds across statements inside an
      // explicit transaction, so (unlike the single-call CAS races elsewhere in this suite) each
      // side here owns its own manual BEGIN/COMMIT rather than an auto-committing bare query.
      const reserve = async (client: typeof clientA, intentId: string) => {
        await client.query('BEGIN');
        try {
          const family = await reserveNonceFamily(client, {
            id: uuid(),
            deploymentId,
            sender,
            intentId,
            unsignedRequest: {},
            expectedTo: fakeAddress('to'),
            expectedCalldataHash: fakeHash32('calldata'),
          });
          await client.query('COMMIT');
          return family;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      };
      const [famA, famB] = await Promise.all([
        reserve(clientA, intentA),
        reserve(clientB, intentB),
      ]);
      expect(famA.nonce).not.toBe(famB.nonce);
      expect([famA.nonce, famB.nonce].sort()).toEqual([0n, 1n]);
    } finally {
      clientA.release();
      clientB.release();
    }
  });

  it('never allocates a second family for the same already-open intent (one_open_nonce_family_per_intent)', async () => {
    await withTransaction(pool, async (client) => {
      const { deployment, intentId } = await createTestIntent(client, 'nonce-one-open');
      const sender = fakeAddress('nonce-one-open-sender');
      await reserveNonceFamily(client, {
        id: uuid(),
        deploymentId: deployment.id,
        sender,
        intentId,
        unsignedRequest: {},
        expectedTo: fakeAddress('to'),
        expectedCalldataHash: fakeHash32('calldata'),
      });
      await expect(
        reserveNonceFamily(client, {
          id: uuid(),
          deploymentId: deployment.id,
          sender,
          intentId,
          unsignedRequest: {},
          expectedTo: fakeAddress('to'),
          expectedCalldataHash: fakeHash32('calldata'),
        }),
      ).rejects.toThrow(/violates unique constraint|one_open_nonce_family_per_intent/i);
    });
  });
});

describe('recoverUnsignedFamilies (SPEC-008)', () => {
  it('surfaces an open family with no signed attempt yet, and excludes one that already has an attempt', async () => {
    await withTransaction(pool, async (client) => {
      const { deployment, intentId: intentUnsigned } = await createTestIntent(
        client,
        'recover-unsigned',
      );
      const { intentId: intentSigned } = await createTestIntent(client, 'recover-signed');
      const sender = fakeAddress('recover-sender');

      const unsignedFamily = await reserveNonceFamily(client, {
        id: uuid(),
        deploymentId: deployment.id,
        sender,
        intentId: intentUnsigned,
        unsignedRequest: {},
        expectedTo: fakeAddress('to'),
        expectedCalldataHash: fakeHash32('calldata'),
      });
      const signedFamily = await reserveNonceFamily(client, {
        id: uuid(),
        deploymentId: deployment.id,
        sender,
        intentId: intentSigned,
        unsignedRequest: {},
        expectedTo: fakeAddress('to'),
        expectedCalldataHash: fakeHash32('calldata'),
      });
      await recordSignedAttempt(client, {
        id: uuid(),
        deploymentId: deployment.id,
        nonceFamilyId: signedFamily.id,
        txHash: fakeHash32('recover-signed-tx'),
        rawSignedTransaction: Buffer.from('aa', 'hex'),
      });

      const recoverable = await recoverUnsignedFamilies(client, {
        deploymentId: deployment.id,
        sender,
      });
      expect(recoverable.map((f) => f.id)).toContain(unsignedFamily.id);
      expect(recoverable.map((f) => f.id)).not.toContain(signedFamily.id);
    });
  });
});

describe('lockSigner: closes the recovery double-sign gap (Stage 5 review finding 1)', () => {
  it('two real concurrent recovery attempts on the same unsigned family produce exactly one signed attempt', async () => {
    const { deployment, sender, family } = await withTransaction(pool, async (client) => {
      const { deployment, intentId } = await createTestIntent(client, 'lock-signer-race');
      const sender = fakeAddress('lock-signer-race-sender');
      const family = await reserveNonceFamily(client, {
        id: uuid(),
        deploymentId: deployment.id,
        sender,
        intentId,
        unsignedRequest: { call: 'executePayment' },
        expectedTo: fakeAddress('to'),
        expectedCalldataHash: fakeHash32('calldata'),
      });
      return { deployment, sender, family };
    });

    // Simulates two worker processes both recovering the same allocated-but-unsigned family: each
    // opens its own connection/transaction, locks the signer row for its WHOLE recovery+sign
    // step (not just allocation), lists unsigned families under that lock, and signs+persists only
    // if the family is still actually unsigned by the time it observes it.
    const recover = async (poolClient: pg.PoolClient, txHash: Buffer) => {
      await poolClient.query('BEGIN');
      try {
        await lockSigner(poolClient, { deploymentId: deployment.id, sender });
        const unsigned = await recoverUnsignedFamilies(poolClient, {
          deploymentId: deployment.id,
          sender,
        });
        const stillUnsigned = unsigned.some((f) => f.id === family.id);
        if (stillUnsigned) {
          await recordSignedAttempt(poolClient, {
            id: uuid(),
            deploymentId: deployment.id,
            nonceFamilyId: family.id,
            txHash,
            rawSignedTransaction: Buffer.from('aa', 'hex'),
          });
        }
        await poolClient.query('COMMIT');
        return stillUnsigned;
      } catch (err) {
        await poolClient.query('ROLLBACK');
        throw err;
      }
    };

    const clientA = await pool.connect();
    const clientB = await pool.connect();
    try {
      const [signedByA, signedByB] = await Promise.all([
        recover(clientA, fakeHash32('lock-signer-race-tx-a')),
        recover(clientB, fakeHash32('lock-signer-race-tx-b')),
      ]);
      // Exactly one recovery attempt actually signs; the other, serialized behind the signer-row
      // lock, observes the family as already-signed and correctly does nothing.
      expect([signedByA, signedByB].filter(Boolean)).toHaveLength(1);

      const finalUnsigned = await recoverUnsignedFamilies(pool, {
        deploymentId: deployment.id,
        sender,
      });
      expect(finalUnsigned.map((f) => f.id)).not.toContain(family.id);
    } finally {
      clientA.release();
      clientB.release();
    }
  });
});

describe('markSiblingAttemptsReplaced (Stage 5 review finding 2)', () => {
  it('marks a losing fee-replacement sibling REPLACED once the winner closes the family', async () => {
    await withTransaction(pool, async (client) => {
      const { deployment, intentId } = await createTestIntent(client, 'sibling-replaced');
      const sender = fakeAddress('sibling-replaced-sender');
      const family = await reserveNonceFamily(client, {
        id: uuid(),
        deploymentId: deployment.id,
        sender,
        intentId,
        unsignedRequest: {},
        expectedTo: fakeAddress('to'),
        expectedCalldataHash: fakeHash32('calldata'),
      });
      const original = await recordSignedAttempt(client, {
        id: uuid(),
        deploymentId: deployment.id,
        nonceFamilyId: family.id,
        txHash: fakeHash32('sibling-replaced-tx-a'),
        rawSignedTransaction: Buffer.from('aa', 'hex'),
      });
      const replacement = await recordFeeReplacement(client, {
        id: uuid(),
        deploymentId: deployment.id,
        nonceFamilyId: family.id,
        txHash: fakeHash32('sibling-replaced-tx-b'),
        rawSignedTransaction: Buffer.from('bb', 'hex'),
        replacementOfId: original.id,
      });
      await markBroadcast(client, { attemptId: original.id, isFirstBroadcast: true });
      await markBroadcast(client, { attemptId: replacement.id, isFirstBroadcast: true });

      await attachCanonicalReceipt(client, {
        attemptId: replacement.id,
        nonceFamilyId: family.id,
        txHash: replacement.txHash,
        state: 'INCLUDED',
      });
      const siblings = await markSiblingAttemptsReplaced(client, {
        nonceFamilyId: family.id,
        winningAttemptId: replacement.id,
      });

      expect(siblings.map((s) => s.id)).toEqual([original.id]);
      expect(siblings[0]!.state).toBe('REPLACED');

      const found = await getTransactionAttemptByHash(client, {
        deploymentId: deployment.id,
        txHash: original.txHash,
      });
      expect(found!.state).toBe('REPLACED');
      // The winner itself must never be touched by its own sibling sweep.
      const winner = await getTransactionAttemptByHash(client, {
        deploymentId: deployment.id,
        txHash: replacement.txHash,
      });
      expect(winner!.state).toBe('INCLUDED');
    });
  });

  it('never touches an attempt belonging to a different nonce family', async () => {
    await withTransaction(pool, async (client) => {
      const {
        deployment,
        family: familyA,
        attempt: attemptA,
      } = await (async () => {
        const { deployment, intentId } = await createTestIntent(client, 'sibling-scope-a');
        const family = await reserveNonceFamily(client, {
          id: uuid(),
          deploymentId: deployment.id,
          sender: fakeAddress('sibling-scope-a-sender'),
          intentId,
          unsignedRequest: {},
          expectedTo: fakeAddress('to'),
          expectedCalldataHash: fakeHash32('calldata'),
        });
        const attempt = await recordSignedAttempt(client, {
          id: uuid(),
          deploymentId: deployment.id,
          nonceFamilyId: family.id,
          txHash: fakeHash32('sibling-scope-a-tx'),
          rawSignedTransaction: Buffer.from('aa', 'hex'),
        });
        return { deployment, family, attempt };
      })();
      const { intentId: intentB } = await createTestIntent(client, 'sibling-scope-b');
      const familyB = await reserveNonceFamily(client, {
        id: uuid(),
        deploymentId: deployment.id,
        sender: fakeAddress('sibling-scope-b-sender'),
        intentId: intentB,
        unsignedRequest: {},
        expectedTo: fakeAddress('to'),
        expectedCalldataHash: fakeHash32('calldata'),
      });
      const attemptB = await recordSignedAttempt(client, {
        id: uuid(),
        deploymentId: deployment.id,
        nonceFamilyId: familyB.id,
        txHash: fakeHash32('sibling-scope-b-tx'),
        rawSignedTransaction: Buffer.from('bb', 'hex'),
      });
      await markBroadcast(client, { attemptId: attemptB.id, isFirstBroadcast: true });
      await attachCanonicalReceipt(client, {
        attemptId: attemptB.id,
        nonceFamilyId: familyB.id,
        txHash: attemptB.txHash,
        state: 'INCLUDED',
      });

      const siblings = await markSiblingAttemptsReplaced(client, {
        nonceFamilyId: familyB.id,
        winningAttemptId: attemptB.id,
      });
      expect(siblings).toHaveLength(0);

      expect(attemptA.nonceFamilyId).toBe(familyA.id);
      const untouched = await getTransactionAttemptByHash(client, {
        deploymentId: deployment.id,
        txHash: attemptA.txHash,
      });
      expect(untouched!.state).toBe('SIGNED');
    });
  });
});

describe('markBroadcast: compare-and-set on transaction_attempts.state', () => {
  it('SIGNED -> SUBMITTED succeeds and stamps first_broadcast_at', async () => {
    await withTransaction(pool, async (client) => {
      const { deployment, intentId } = await createTestIntent(client, 'broadcast-ok');
      const family = await reserveNonceFamily(client, {
        id: uuid(),
        deploymentId: deployment.id,
        sender: fakeAddress('broadcast-ok-sender'),
        intentId,
        unsignedRequest: {},
        expectedTo: fakeAddress('to'),
        expectedCalldataHash: fakeHash32('calldata'),
      });
      const attempt = await recordSignedAttempt(client, {
        id: uuid(),
        deploymentId: deployment.id,
        nonceFamilyId: family.id,
        txHash: fakeHash32('broadcast-ok-tx'),
        rawSignedTransaction: Buffer.from('aa', 'hex'),
      });
      expect(attempt.state).toBe('SIGNED');

      const broadcast = await markBroadcast(client, {
        attemptId: attempt.id,
        isFirstBroadcast: true,
      });
      expect(broadcast.state).toBe('SUBMITTED');
      expect(broadcast.firstBroadcastAt).not.toBeNull();
    });
  });

  it('a duplicate broadcast call (already SUBMITTED) is an idempotent no-op, not an error', async () => {
    await withTransaction(pool, async (client) => {
      const { deployment, intentId } = await createTestIntent(client, 'broadcast-dup');
      const family = await reserveNonceFamily(client, {
        id: uuid(),
        deploymentId: deployment.id,
        sender: fakeAddress('broadcast-dup-sender'),
        intentId,
        unsignedRequest: {},
        expectedTo: fakeAddress('to'),
        expectedCalldataHash: fakeHash32('calldata'),
      });
      const attempt = await recordSignedAttempt(client, {
        id: uuid(),
        deploymentId: deployment.id,
        nonceFamilyId: family.id,
        txHash: fakeHash32('broadcast-dup-tx'),
        rawSignedTransaction: Buffer.from('aa', 'hex'),
      });
      const first = await markBroadcast(client, { attemptId: attempt.id, isFirstBroadcast: true });
      const second = await markBroadcast(client, {
        attemptId: attempt.id,
        isFirstBroadcast: false,
      });
      expect(second.state).toBe('SUBMITTED');
      expect(second.firstBroadcastAt!.getTime()).toBe(first.firstBroadcastAt!.getTime());
    });
  });

  it('rejects marking broadcast on an attempt already past SUBMITTED (e.g. INCLUDED)', async () => {
    await withTransaction(pool, async (client) => {
      const { deployment, intentId } = await createTestIntent(client, 'broadcast-illegal');
      const family = await reserveNonceFamily(client, {
        id: uuid(),
        deploymentId: deployment.id,
        sender: fakeAddress('broadcast-illegal-sender'),
        intentId,
        unsignedRequest: {},
        expectedTo: fakeAddress('to'),
        expectedCalldataHash: fakeHash32('calldata'),
      });
      const attempt = await recordSignedAttempt(client, {
        id: uuid(),
        deploymentId: deployment.id,
        nonceFamilyId: family.id,
        txHash: fakeHash32('broadcast-illegal-tx'),
        rawSignedTransaction: Buffer.from('aa', 'hex'),
      });
      await markBroadcast(client, { attemptId: attempt.id, isFirstBroadcast: true });
      await attachCanonicalReceipt(client, {
        attemptId: attempt.id,
        nonceFamilyId: family.id,
        txHash: attempt.txHash,
        state: 'INCLUDED',
      });

      await expect(
        markBroadcast(client, { attemptId: attempt.id, isFirstBroadcast: false }),
      ).rejects.toBeInstanceOf(InvalidTransactionAttemptStateTransitionError);
    });
  });
});

describe('attachCanonicalReceipt: cross-check and idempotent replay', () => {
  async function setupIncludable(
    client: Parameters<typeof createTestVaultChain>[0],
    label: string,
  ) {
    const { deployment, intentId } = await createTestIntent(client, label);
    const family = await reserveNonceFamily(client, {
      id: uuid(),
      deploymentId: deployment.id,
      sender: fakeAddress(`${label}-sender`),
      intentId,
      unsignedRequest: {},
      expectedTo: fakeAddress('to'),
      expectedCalldataHash: fakeHash32('calldata'),
    });
    const attempt = await recordSignedAttempt(client, {
      id: uuid(),
      deploymentId: deployment.id,
      nonceFamilyId: family.id,
      txHash: fakeHash32(`${label}-tx`),
      rawSignedTransaction: Buffer.from('aa', 'hex'),
    });
    await markBroadcast(client, { attemptId: attempt.id, isFirstBroadcast: true });
    return { deployment, family, attempt };
  }

  it('closes the nonce family with the canonical hash and removes it from recovery', async () => {
    await withTransaction(pool, async (client) => {
      const { deployment, family, attempt } = await setupIncludable(client, 'receipt-ok');
      const result = await attachCanonicalReceipt(client, {
        attemptId: attempt.id,
        nonceFamilyId: family.id,
        txHash: attempt.txHash,
        state: 'INCLUDED',
      });
      expect(result.state).toBe('INCLUDED');

      const closedFamily = await getNonceFamilyById(client, family.id);
      expect(closedFamily!.closedAt).not.toBeNull();
      expect(closedFamily!.canonicalTxHash!.equals(attempt.txHash)).toBe(true);

      const recoverable = await recoverUnsignedFamilies(client, {
        deploymentId: deployment.id,
        sender: fakeAddress('receipt-ok-sender'),
      });
      expect(recoverable.map((f) => f.id)).not.toContain(family.id);
    });
  });

  it('rejects when attemptId does not actually belong to the supplied nonceFamilyId', async () => {
    await withTransaction(pool, async (client) => {
      const { attempt } = await setupIncludable(client, 'receipt-mismatch-a');
      const { family: otherFamily } = await setupIncludable(client, 'receipt-mismatch-b');

      await expect(
        attachCanonicalReceipt(client, {
          attemptId: attempt.id,
          nonceFamilyId: otherFamily.id, // wrong family for this attempt
          txHash: attempt.txHash,
          state: 'INCLUDED',
        }),
      ).rejects.toThrow(/belongs to nonce family/);
    });
  });

  it('re-delivering the identical observation is an idempotent no-op', async () => {
    await withTransaction(pool, async (client) => {
      const { family, attempt } = await setupIncludable(client, 'receipt-replay');
      const first = await attachCanonicalReceipt(client, {
        attemptId: attempt.id,
        nonceFamilyId: family.id,
        txHash: attempt.txHash,
        state: 'INCLUDED',
      });
      const second = await attachCanonicalReceipt(client, {
        attemptId: attempt.id,
        nonceFamilyId: family.id,
        txHash: attempt.txHash,
        state: 'INCLUDED',
      });
      expect(second.state).toBe('INCLUDED');
      expect(second.id).toBe(first.id);
    });
  });

  it('a second, different attempt cannot close an already-closed nonce family', async () => {
    await withTransaction(pool, async (client) => {
      const { deployment, intentId } = await createTestIntent(client, 'receipt-double-close');
      const sender = fakeAddress('receipt-double-close-sender');
      const family = await reserveNonceFamily(client, {
        id: uuid(),
        deploymentId: deployment.id,
        sender,
        intentId,
        unsignedRequest: {},
        expectedTo: fakeAddress('to'),
        expectedCalldataHash: fakeHash32('calldata'),
      });
      const attemptA = await recordSignedAttempt(client, {
        id: uuid(),
        deploymentId: deployment.id,
        nonceFamilyId: family.id,
        txHash: fakeHash32('receipt-double-close-tx-a'),
        rawSignedTransaction: Buffer.from('aa', 'hex'),
      });
      const attemptB = await recordFeeReplacement(client, {
        id: uuid(),
        deploymentId: deployment.id,
        nonceFamilyId: family.id,
        txHash: fakeHash32('receipt-double-close-tx-b'),
        rawSignedTransaction: Buffer.from('bb', 'hex'),
        replacementOfId: attemptA.id,
      });
      await markBroadcast(client, { attemptId: attemptA.id, isFirstBroadcast: true });
      await markBroadcast(client, { attemptId: attemptB.id, isFirstBroadcast: true });

      await attachCanonicalReceipt(client, {
        attemptId: attemptB.id,
        nonceFamilyId: family.id,
        txHash: attemptB.txHash,
        state: 'INCLUDED',
      });

      // attemptA racing in with a DIFFERENT observed hash for the same already-closed family must
      // not silently overwrite the canonical winner.
      await expect(
        attachCanonicalReceipt(client, {
          attemptId: attemptA.id,
          nonceFamilyId: family.id,
          txHash: attemptA.txHash,
          state: 'INCLUDED',
        }),
      ).rejects.toThrow(/already-closed nonce family|already closed by a different attempt/);
    });
  });
});

describe('recordFeeReplacement: nonce-family linkage is verified, not trusted', () => {
  it("accepts a replacement correctly linked to the original attempt's own nonce family", async () => {
    await withTransaction(pool, async (client) => {
      const { deployment, intentId } = await createTestIntent(client, 'fee-replace-ok');
      const family = await reserveNonceFamily(client, {
        id: uuid(),
        deploymentId: deployment.id,
        sender: fakeAddress('fee-replace-ok-sender'),
        intentId,
        unsignedRequest: {},
        expectedTo: fakeAddress('to'),
        expectedCalldataHash: fakeHash32('calldata'),
      });
      const original = await recordSignedAttempt(client, {
        id: uuid(),
        deploymentId: deployment.id,
        nonceFamilyId: family.id,
        txHash: fakeHash32('fee-replace-ok-tx-1'),
        rawSignedTransaction: Buffer.from('aa', 'hex'),
      });
      const replacement = await recordFeeReplacement(client, {
        id: uuid(),
        deploymentId: deployment.id,
        nonceFamilyId: family.id,
        txHash: fakeHash32('fee-replace-ok-tx-2'),
        rawSignedTransaction: Buffer.from('bb', 'hex'),
        replacementOfId: original.id,
      });
      expect(replacement.replacementOfId).toBe(original.id);
      expect(replacement.nonceFamilyId).toBe(family.id);
    });
  });

  it("rejects a replacement whose supplied nonceFamilyId disagrees with the original attempt's actual family", async () => {
    await withTransaction(pool, async (client) => {
      const { deployment, intentId: intentA } = await createTestIntent(client, 'fee-replace-bad-a');
      const { intentId: intentB } = await createTestIntent(client, 'fee-replace-bad-b');
      const familyA = await reserveNonceFamily(client, {
        id: uuid(),
        deploymentId: deployment.id,
        sender: fakeAddress('fee-replace-bad-sender-a'),
        intentId: intentA,
        unsignedRequest: {},
        expectedTo: fakeAddress('to'),
        expectedCalldataHash: fakeHash32('calldata'),
      });
      const familyB = await reserveNonceFamily(client, {
        id: uuid(),
        deploymentId: deployment.id,
        sender: fakeAddress('fee-replace-bad-sender-b'),
        intentId: intentB,
        unsignedRequest: {},
        expectedTo: fakeAddress('to'),
        expectedCalldataHash: fakeHash32('calldata'),
      });
      const original = await recordSignedAttempt(client, {
        id: uuid(),
        deploymentId: deployment.id,
        nonceFamilyId: familyA.id,
        txHash: fakeHash32('fee-replace-bad-tx-1'),
        rawSignedTransaction: Buffer.from('aa', 'hex'),
      });

      await expect(
        recordFeeReplacement(client, {
          id: uuid(),
          deploymentId: deployment.id,
          nonceFamilyId: familyB.id, // wrong family -- original actually belongs to familyA
          txHash: fakeHash32('fee-replace-bad-tx-2'),
          rawSignedTransaction: Buffer.from('bb', 'hex'),
          replacementOfId: original.id,
        }),
      ).rejects.toThrow(/belongs to nonce family/);
    });
  });
});

describe('getTransactionAttemptByHash', () => {
  it('finds a recorded attempt by its exact hash within the deployment', async () => {
    await withTransaction(pool, async (client) => {
      const { deployment, intentId } = await createTestIntent(client, 'lookup-by-hash');
      const family = await reserveNonceFamily(client, {
        id: uuid(),
        deploymentId: deployment.id,
        sender: fakeAddress('lookup-by-hash-sender'),
        intentId,
        unsignedRequest: {},
        expectedTo: fakeAddress('to'),
        expectedCalldataHash: fakeHash32('calldata'),
      });
      const txHash = fakeHash32('lookup-by-hash-tx');
      const attempt = await recordSignedAttempt(client, {
        id: uuid(),
        deploymentId: deployment.id,
        nonceFamilyId: family.id,
        txHash,
        rawSignedTransaction: Buffer.from('aa', 'hex'),
      });
      const found = await getTransactionAttemptByHash(client, {
        deploymentId: deployment.id,
        txHash,
      });
      expect(found!.id).toBe(attempt.id);
    });
  });
});
