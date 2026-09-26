import type pg from 'pg';
import { createSignedArtifact } from '../../src/repositories/artifacts.js';
import {
  createDeployment,
  createVault,
  findOrCreateWallet,
} from '../../src/repositories/deployments.js';
import { fakeAddress, fakeHash32, uuid } from './testDb.js';

export async function createTestDeployment(client: pg.PoolClient, label: string) {
  return createDeployment(client, {
    id: uuid(),
    chainId: 31337n,
    instanceLabel: `test-${label}-${uuid()}`,
    environment: 'LOCAL_DEMO',
    startBlock: 0n,
    genesisOrAnchorHash: fakeHash32(`genesis-${label}-${uuid()}`),
    configuration: {},
  });
}

export async function createTestOwnerWallet(client: pg.PoolClient, label: string) {
  return findOrCreateWallet(client, {
    id: uuid(),
    address: fakeAddress(`owner-${label}-${uuid()}`),
  });
}

export async function createTestVault(
  client: pg.PoolClient,
  params: { deploymentId: string; ownerWalletId: string; label: string },
) {
  return createVault(client, {
    id: uuid(),
    deploymentId: params.deploymentId,
    ownerWalletId: params.ownerWalletId,
    address: fakeAddress(`vault-${params.label}-${uuid()}`),
    runtimeCodeHash: fakeHash32(`code-${params.label}`),
    abiSchemaVersion: '1',
  });
}

/** Builds one full deployment -> owner wallet -> vault chain in a single transaction. */
export async function createTestVaultChain(client: pg.PoolClient, label: string) {
  const deployment = await createTestDeployment(client, label);
  const owner = await createTestOwnerWallet(client, label);
  const vault = await createTestVault(client, {
    deploymentId: deployment.id,
    ownerWalletId: owner.id,
    label,
  });
  return { deployment, owner, vault };
}

/** Inserts a minimal but fully-valid policies row directly (raw SQL -- policies repo functions
 * land with the contract-facing API layer in a later stage; Stage 3 only needs a real row to
 * hang FK/constraint tests off of). Returns the policy id. */
export async function insertTestPolicy(
  client: pg.PoolClient,
  params: { vaultId: string; totalOutputBudget?: bigint },
): Promise<string> {
  const id = uuid();
  const budget = (params.totalOutputBudget ?? 100n).toString(10);
  await client.query(
    `INSERT INTO policies (
       id, vault_id, onchain_policy_id, agent, input_token, settlement_token, adapter, route_id,
       total_output_budget, epoch_output_budget, automatic_output_cap, escalation_output_cap,
       total_input_budget, max_input_per_payment, valid_after, valid_until, subsidy_mode,
       canonical_config_bytes, config_projection, observed_status, observed_block_hash
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,
       $9,$9,$9,$9,
       $9,$9,0,999999999,0,
       $10,$11,'ACTIVE',$3
     )`,
    [
      id,
      params.vaultId,
      fakeHash32(`policy-${id}`),
      fakeAddress(`agent-${id}`),
      fakeAddress(`in-${id}`),
      fakeAddress(`out-${id}`),
      fakeAddress(`adapter-${id}`),
      fakeHash32(`route-${id}`),
      budget,
      Buffer.from('ca', 'hex'),
      JSON.stringify({}),
    ],
  );
  return id;
}

/** Inserts a minimal signed_artifacts row and returns its id. */
export async function insertTestArtifact(client: pg.PoolClient, label: string): Promise<string> {
  // Uniquified internally (not just by the caller's label) so this fixture is safe to call
  // repeatedly across separate test runs against the same un-truncated database.
  const unique = `${label}-${uuid()}`;
  const artifact = await createSignedArtifact(client, {
    id: uuid(),
    kind: 'INVOICE',
    digest: fakeHash32(`digest-${unique}`),
    signer: fakeAddress(`signer-${unique}`),
    encodedPayload: Buffer.from('aa', 'hex'),
    typedData: {},
    signature: Buffer.from('bb', 'hex'),
    signatureHash: fakeHash32(`sig-${unique}`),
    schemaVersion: '1',
  });
  return artifact.id;
}

/** Inserts a minimal invoices row directly and returns its id. */
export async function insertTestInvoice(
  client: pg.PoolClient,
  params: { vaultId: string; artifactId: string; label: string },
): Promise<string> {
  const id = uuid();
  const unique = `${params.label}-${uuid()}`;
  await client.query(
    `INSERT INTO invoices (id, vault_id, invoice_id, recipient, merchant_id, settlement_token, output_amount, valid_until, invoice_digest, artifact_id)
     VALUES ($1,$2,$3,$4,$5,$6,1,999999999,$7,$8)`,
    [
      id,
      params.vaultId,
      fakeHash32(`invid-${unique}`),
      fakeAddress(`recipient-${unique}`),
      fakeHash32(`merchant-${unique}`),
      fakeAddress(`token-${unique}`),
      fakeHash32(`digest-${unique}`),
      params.artifactId,
    ],
  );
  return id;
}

/** Inserts a minimal payments row directly and returns its id. */
export async function insertTestPayment(
  client: pg.PoolClient,
  params: { vaultId: string; invoiceId: string },
): Promise<string> {
  const id = uuid();
  await client.query(
    `INSERT INTO payments (id, vault_id, invoice_id, policy_decision, execution_status, confidence, reconciliation)
     VALUES ($1,$2,$3,'ALLOW','DRAFT','UNOBSERVED','NOT_CHECKED')`,
    [id, params.vaultId, params.invoiceId],
  );
  return id;
}
