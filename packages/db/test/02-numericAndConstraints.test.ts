import { beforeAll, describe, expect, it } from 'vitest';
import { withTransaction } from '../src/pool.js';
import { createSignedArtifact } from '../src/repositories/artifacts.js';
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

describe('uint256 domain: exact round-trip and rejection', () => {
  it('round-trips the exact uint256 max through a real policies column', async () => {
    const uint256Max =
      115792089237316195423570985008687907853269984665640564039457584007913129639935n;
    await withTransaction(pool, async (client) => {
      const { vault } = await createTestVaultChain(client, 'numeric-roundtrip');
      const policyId = await insertTestPolicy(client, {
        vaultId: vault.id,
        totalOutputBudget: uint256Max,
      });
      const read = await client.query<{ echoed: string }>(
        'SELECT total_output_budget::text AS echoed FROM policies WHERE id = $1',
        [policyId],
      );
      expect(BigInt(read.rows[0]!.echoed)).toBe(uint256Max);
    });
  });

  it('rejects a fractional value', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        const { deployment } = await createTestVaultChain(client, 'frac');
        await client.query('UPDATE deployments SET chain_id = $1 WHERE id = $2', [
          '1.5',
          deployment.id,
        ]);
      }),
    ).rejects.toThrow(/uint256/);
  });

  it('rejects a negative value', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        const { deployment } = await createTestVaultChain(client, 'neg');
        await client.query('UPDATE deployments SET chain_id = $1 WHERE id = $2', [
          '-1',
          deployment.id,
        ]);
      }),
    ).rejects.toThrow(/uint256/);
  });

  it('rejects a value above the uint256 max', async () => {
    const tooBig = '115792089237316195423570985008687907853269984665640564039457584007913129639936';
    await expect(
      withTransaction(pool, async (client) => {
        const { deployment } = await createTestVaultChain(client, 'toobig');
        await client.query('UPDATE deployments SET chain_id = $1 WHERE id = $2', [
          tooBig,
          deployment.id,
        ]);
      }),
    ).rejects.toThrow(/uint256/);
  });

  it('rejects NaN (non-finite)', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        const { deployment } = await createTestVaultChain(client, 'nan');
        await client.query("UPDATE deployments SET chain_id = 'NaN' WHERE id = $1", [
          deployment.id,
        ]);
      }),
    ).rejects.toThrow();
  });

  it('rejects NULL on a required column', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        const { deployment } = await createTestVaultChain(client, 'null');
        await client.query('UPDATE deployments SET chain_id = NULL WHERE id = $1', [deployment.id]);
      }),
    ).rejects.toThrow(/null value|not-null/i);
  });
});

describe('evm_address / hash32 domains: exact byte-length round-trip and rejection', () => {
  it('round-trips a real 20-byte address unchanged', async () => {
    await withTransaction(pool, async (client) => {
      const { owner } = await createTestVaultChain(client, 'addr-roundtrip');
      const read = await client.query<{ address: Buffer }>(
        'SELECT address FROM wallets WHERE id = $1',
        [owner.id],
      );
      expect(read.rows[0]!.address).toHaveLength(20);
      expect(read.rows[0]!.address.equals(owner.address)).toBe(true);
    });
  });

  it('rejects a 19-byte address', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        await client.query('INSERT INTO wallets (id, address) VALUES ($1, $2)', [
          uuid(),
          Buffer.alloc(19),
        ]);
      }),
    ).rejects.toThrow(/evm_address/);
  });

  it('rejects a 21-byte address', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        await client.query('INSERT INTO wallets (id, address) VALUES ($1, $2)', [
          uuid(),
          Buffer.alloc(21),
        ]);
      }),
    ).rejects.toThrow(/evm_address/);
  });

  it('rejects a 31-byte value in a hash32 column', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        const { deployment } = await createTestVaultChain(client, 'hash31');
        await client.query('UPDATE deployments SET genesis_or_anchor_hash = $1 WHERE id = $2', [
          Buffer.alloc(31),
          deployment.id,
        ]);
      }),
    ).rejects.toThrow(/hash32/);
  });
});

describe('signed_artifacts: immutable evidence', () => {
  it('persists the exact encoded payload and signature bytes', async () => {
    await withTransaction(pool, async (client) => {
      const payload = Buffer.from('deadbeef', 'hex');
      const signature = Buffer.from('cafebabe', 'hex');
      const artifact = await createSignedArtifact(client, {
        id: uuid(),
        kind: 'INVOICE',
        digest: fakeHash32('digest-immutable'),
        signer: fakeAddress('signer-immutable'),
        encodedPayload: payload,
        typedData: { hello: 'world' },
        signature,
        signatureHash: fakeHash32('sig-hash-immutable'),
        schemaVersion: '1',
      });
      expect(artifact.encodedPayload.equals(payload)).toBe(true);
      expect(artifact.signature.equals(signature)).toBe(true);
    });
  });

  it('rejects an UPDATE against an existing signed_artifacts row', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        const artifact = await createSignedArtifact(client, {
          id: uuid(),
          kind: 'INTENT',
          digest: fakeHash32('digest-reject-update'),
          signer: fakeAddress('signer-reject-update'),
          encodedPayload: Buffer.from('aa', 'hex'),
          typedData: {},
          signature: Buffer.from('bb', 'hex'),
          signatureHash: fakeHash32('sig-hash-reject-update'),
          schemaVersion: '1',
        });
        await client.query('UPDATE signed_artifacts SET signature = $1 WHERE id = $2', [
          Buffer.from('cc', 'hex'),
          artifact.id,
        ]);
      }),
    ).rejects.toThrow(/immutable/);
  });
});

describe('foreign keys: cross-vault/cross-deployment forgery is rejected', () => {
  it('rejects a vault referencing a nonexistent deployment', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        const { owner } = await createTestVaultChain(client, 'fk-vault-base');
        await client.query(
          'INSERT INTO vaults (id, deployment_id, owner_wallet_id, address, runtime_code_hash, abi_schema_version) VALUES ($1,$2,$3,$4,$5,$6)',
          [uuid(), uuid(), owner.id, fakeAddress('forged-vault'), fakeHash32('code'), '1'],
        );
      }),
    ).rejects.toThrow(/violates foreign key/);
  });

  it('rejects a payment_intents row whose vault_id does not match its own payment (forged cross-vault reference)', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        const chainA = await createTestVaultChain(client, 'fk-cross-a');
        const chainB = await createTestVaultChain(client, 'fk-cross-b');

        const invoiceArtifactId = await insertTestArtifact(client, 'fk-cross-invoice');
        const invoiceId = await insertTestInvoice(client, {
          vaultId: chainA.vault.id,
          artifactId: invoiceArtifactId,
          label: 'fk-cross',
        });
        const paymentId = await insertTestPayment(client, { vaultId: chainA.vault.id, invoiceId });
        const policyIdOnVaultB = await insertTestPolicy(client, { vaultId: chainB.vault.id });
        const intentArtifactId = await insertTestArtifact(client, 'fk-cross-intent');

        // Forged: the payment belongs to vault A, the policy belongs to vault B, but this row
        // claims vault_id = A while pointing at vault B's policy -- no (policyId, vaultA) row
        // exists in policies, so the composite FK must reject it.
        await client.query(
          `INSERT INTO payment_intents (id, payment_id, vault_id, policy_id, version, intent_digest, artifact_id, agent_nonce, max_input_amount, valid_until)
           VALUES ($1,$2,$3,$4,1,$5,$6,0,1,999999999)`,
          [
            uuid(),
            paymentId,
            chainA.vault.id,
            policyIdOnVaultB,
            fakeHash32('intent-fk-cross'),
            intentArtifactId,
          ],
        );
      }),
    ).rejects.toThrow(/violates foreign key/);
  });
});

describe('unique and partial-unique indexes', () => {
  it('rejects a duplicate invoice (same vault/recipient/invoiceId)', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        const { vault } = await createTestVaultChain(client, 'dup-invoice');
        const artifactId = await insertTestArtifact(client, 'dup-invoice');
        const recipient = fakeAddress('dup-invoice-recipient');
        const invoiceIdBytes = fakeHash32('dup-invoice-id');
        const insertOne = () =>
          client.query(
            `INSERT INTO invoices (id, vault_id, invoice_id, recipient, merchant_id, settlement_token, output_amount, valid_until, invoice_digest, artifact_id)
             VALUES ($1,$2,$3,$4,$5,$6,1,999999999,$7,$8)`,
            [
              uuid(),
              vault.id,
              invoiceIdBytes,
              recipient,
              fakeHash32('merchant-dup'),
              fakeAddress('token-dup'),
              fakeHash32('digest-dup'),
              artifactId,
            ],
          );
        await insertOne();
        await insertOne();
      }),
    ).rejects.toThrow(/duplicate key/);
  });

  it('rejects two active intent versions for the same payment (one_active_intent_per_payment)', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        const { vault } = await createTestVaultChain(client, 'dup-active-intent');
        const invoiceArtifactId = await insertTestArtifact(client, 'dup-active-invoice');
        const invoiceId = await insertTestInvoice(client, {
          vaultId: vault.id,
          artifactId: invoiceArtifactId,
          label: 'dup-active',
        });
        const paymentId = await insertTestPayment(client, { vaultId: vault.id, invoiceId });
        const policyId = await insertTestPolicy(client, { vaultId: vault.id });
        const intentArtifactId = await insertTestArtifact(client, 'dup-active-intent');

        const insertIntent = (version: number) =>
          client.query(
            `INSERT INTO payment_intents (id, payment_id, vault_id, policy_id, version, intent_digest, artifact_id, agent_nonce, max_input_amount, valid_until)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,999999999)`,
            [
              uuid(),
              paymentId,
              vault.id,
              policyId,
              version,
              fakeHash32(`intent-dup-${version}`),
              intentArtifactId,
              version,
            ],
          );
        await insertIntent(1);
        await insertIntent(2); // both left with retired_at IS NULL -- must violate the partial unique index
      }),
    ).rejects.toThrow(/duplicate key|one_active_intent_per_payment/);
  });

  it('rejects two open nonce families for the same intent (one_open_nonce_family_per_intent)', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        const { vault, deployment } = await createTestVaultChain(client, 'dup-open-nonce');
        const invoiceArtifactId = await insertTestArtifact(client, 'dup-open-nonce-invoice');
        const invoiceId = await insertTestInvoice(client, {
          vaultId: vault.id,
          artifactId: invoiceArtifactId,
          label: 'dup-open-nonce',
        });
        const paymentId = await insertTestPayment(client, { vaultId: vault.id, invoiceId });
        const policyId = await insertTestPolicy(client, { vaultId: vault.id });
        const intentArtifactId = await insertTestArtifact(client, 'dup-open-nonce-intent');
        const intentId = uuid();
        await client.query(
          `INSERT INTO payment_intents (id, payment_id, vault_id, policy_id, version, intent_digest, artifact_id, agent_nonce, max_input_amount, valid_until)
           VALUES ($1,$2,$3,$4,1,$5,$6,0,1,999999999)`,
          [
            intentId,
            paymentId,
            vault.id,
            policyId,
            fakeHash32('intent-dup-open-nonce'),
            intentArtifactId,
          ],
        );

        const sender = fakeAddress('dup-open-nonce-sender');
        const insertFamily = (nonce: number) =>
          client.query(
            `INSERT INTO nonce_families (id, deployment_id, sender, nonce, intent_id, unsigned_request, expected_to, expected_calldata_hash)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              uuid(),
              deployment.id,
              sender,
              nonce,
              intentId,
              JSON.stringify({}),
              fakeAddress('dup-open-nonce-to'),
              fakeHash32('dup-open-nonce-calldata'),
            ],
          );
        await insertFamily(0);
        await insertFamily(1); // both closed_at IS NULL for the SAME intent -- must violate the partial unique index
      }),
    ).rejects.toThrow(/duplicate key|one_open_nonce_family_per_intent/);
  });

  it('rejects two canonical blocks at the same height (canonical_block_height)', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        const { deployment } = await createTestVaultChain(client, 'dup-canonical-block');
        const insertBlock = (hashLabel: string) =>
          client.query(
            `INSERT INTO chain_blocks (deployment_id, block_hash, block_number, parent_hash, canonical, confidence)
             VALUES ($1,$2,42,$3,true,'INCLUDED')`,
            [deployment.id, fakeHash32(hashLabel), fakeHash32('parent')],
          );
        await insertBlock('block-a');
        await insertBlock('block-b'); // same height, both canonical
      }),
    ).rejects.toThrow(/duplicate key|canonical_block_height/);
  });

  it('rejects two canonical receipts for the same tx (canonical_receipt_per_tx)', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        const { deployment } = await createTestVaultChain(client, 'dup-canonical-receipt');
        const txHash = fakeHash32('dup-canonical-receipt-tx');
        const insertReceipt = (blockLabel: string) =>
          client
            .query(
              `INSERT INTO chain_blocks (deployment_id, block_hash, block_number, parent_hash, canonical, confidence)
             VALUES ($1,$2,$3,$4,true,'INCLUDED')`,
              [
                deployment.id,
                fakeHash32(blockLabel),
                blockLabel === 'r-block-a' ? 1 : 2,
                fakeHash32('parent-r'),
              ],
            )
            .then(() =>
              client.query(
                `INSERT INTO receipts (deployment_id, tx_hash, block_hash, receipt_status, canonical, raw_receipt)
               VALUES ($1,$2,$3,1,true,$4)`,
                [deployment.id, txHash, fakeHash32(blockLabel), JSON.stringify({})],
              ),
            );
        await insertReceipt('r-block-a');
        await insertReceipt('r-block-b'); // same tx_hash, both canonical
      }),
    ).rejects.toThrow(/duplicate key|canonical_receipt_per_tx/);
  });
});
