/**
 * Deployment/wallet/vault bootstrap -- explicit use-case queries, not a generic CRUD layer
 * (Prompt 3 item 6). "deployments" is the entity that distinguishes one local/testnet install
 * from another even after a same-chain reset (ARCH 3.2); every other domain row traces back to
 * it transitively through vault_id, so a fresh deployment row with a fresh id/instance_label is
 * what actually makes a reset's old payment rows unreachable under the new instance's scope --
 * they still exist (nothing is deleted), they are just never selected by a query scoped to the
 * new deployment_id.
 */
import type pg from 'pg';
import type { Queryable } from '../pool.js';

export interface DeploymentRow {
  id: string;
  chainId: bigint;
  instanceLabel: string;
  environment: 'LOCAL_DEMO' | 'TESTNET';
  startBlock: bigint;
  genesisOrAnchorHash: Buffer;
  configuration: unknown;
  createdAt: Date;
}

function mapDeploymentRow(row: Record<string, unknown>): DeploymentRow {
  return {
    id: row.id as string,
    chainId: BigInt(row.chain_id as string),
    instanceLabel: row.instance_label as string,
    environment: row.environment as DeploymentRow['environment'],
    startBlock: BigInt(row.start_block as string),
    genesisOrAnchorHash: row.genesis_or_anchor_hash as Buffer,
    configuration: row.configuration,
    createdAt: row.created_at as Date,
  };
}

/**
 * Creates exactly one new deployment instance. Deterministic given its inputs (no random
 * defaults chosen inside this function) -- the caller supplies id/instanceLabel, so a real local
 * reset is expressed as calling this again with a fresh id and a fresh, still-unique
 * instanceLabel, never by mutating or reusing the previous deployment row.
 */
export async function createDeployment(
  client: pg.PoolClient,
  params: {
    id: string;
    chainId: bigint;
    instanceLabel: string;
    environment: 'LOCAL_DEMO' | 'TESTNET';
    startBlock: bigint;
    genesisOrAnchorHash: Buffer;
    configuration: unknown;
  },
): Promise<DeploymentRow> {
  const result = await client.query(
    `INSERT INTO deployments (id, chain_id, instance_label, environment, start_block, genesis_or_anchor_hash, configuration)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      params.id,
      params.chainId.toString(10),
      params.instanceLabel,
      params.environment,
      params.startBlock.toString(10),
      params.genesisOrAnchorHash,
      JSON.stringify(params.configuration),
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('createDeployment: INSERT ... RETURNING produced no row');
  return mapDeploymentRow(row);
}

export async function getDeploymentById(db: Queryable, id: string): Promise<DeploymentRow | null> {
  const result = await db.query('SELECT * FROM deployments WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapDeploymentRow(row) : null;
}

export interface WalletRow {
  id: string;
  address: Buffer;
  createdAt: Date;
}

function mapWalletRow(row: Record<string, unknown>): WalletRow {
  return {
    id: row.id as string,
    address: row.address as Buffer,
    createdAt: row.created_at as Date,
  };
}

/**
 * Idempotent by the wallet's real identity (its address, the unique natural key) rather than by
 * a caller-supplied id: the first caller to see a given address creates the row, every later
 * caller for the same address gets the same row back.
 */
export async function findOrCreateWallet(
  client: pg.PoolClient,
  params: { id: string; address: Buffer },
): Promise<WalletRow> {
  const inserted = await client.query(
    `INSERT INTO wallets (id, address) VALUES ($1,$2)
     ON CONFLICT (address) DO NOTHING
     RETURNING *`,
    [params.id, params.address],
  );
  if (inserted.rows[0]) return mapWalletRow(inserted.rows[0]);
  const existing = await client.query('SELECT * FROM wallets WHERE address = $1', [params.address]);
  const row = existing.rows[0];
  if (!row) throw new Error('findOrCreateWallet: conflict but no existing row found (race?)');
  return mapWalletRow(row);
}

export interface VaultRow {
  id: string;
  deploymentId: string;
  ownerWalletId: string;
  address: Buffer;
  runtimeCodeHash: Buffer;
  abiSchemaVersion: string;
}

function mapVaultRow(row: Record<string, unknown>): VaultRow {
  return {
    id: row.id as string,
    deploymentId: row.deployment_id as string,
    ownerWalletId: row.owner_wallet_id as string,
    address: row.address as Buffer,
    runtimeCodeHash: row.runtime_code_hash as Buffer,
    abiSchemaVersion: row.abi_schema_version as string,
  };
}

export async function createVault(
  client: pg.PoolClient,
  params: {
    id: string;
    deploymentId: string;
    ownerWalletId: string;
    address: Buffer;
    runtimeCodeHash: Buffer;
    abiSchemaVersion: string;
  },
): Promise<VaultRow> {
  const result = await client.query(
    `INSERT INTO vaults (id, deployment_id, owner_wallet_id, address, runtime_code_hash, abi_schema_version)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      params.id,
      params.deploymentId,
      params.ownerWalletId,
      params.address,
      params.runtimeCodeHash,
      params.abiSchemaVersion,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('createVault: INSERT ... RETURNING produced no row');
  return mapVaultRow(row);
}

export async function getVaultsByDeployment(
  db: Queryable,
  deploymentId: string,
): Promise<VaultRow[]> {
  const result = await db.query('SELECT * FROM vaults WHERE deployment_id = $1 ORDER BY id', [
    deploymentId,
  ]);
  return result.rows.map(mapVaultRow);
}

// --- Stage 4 authorization-scoped reads -------------------------------------------------------

export async function getWalletByAddress(
  db: Queryable,
  address: Buffer,
): Promise<WalletRow | null> {
  const result = await db.query('SELECT * FROM wallets WHERE address = $1', [address]);
  const row = result.rows[0];
  return row ? mapWalletRow(row) : null;
}

/**
 * Bare-id vault read. Stage 3's review flagged that by-id reads carry no ownership scoping, so
 * this MUST be paired with an explicit ownership predicate by the caller -- prefer
 * `getVaultForOwner` below, which does the scoping in SQL and cannot be misused.
 */
export async function getVaultById(db: Queryable, id: string): Promise<VaultRow | null> {
  const result = await db.query('SELECT * FROM vaults WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapVaultRow(row) : null;
}

/**
 * Ownership-scoped read: returns the vault only when it belongs to this wallet. A valid vault UUID
 * owned by somebody else yields null rather than a row, so an IDOR attempt cannot even reach the
 * projection layer.
 */
export async function getVaultForOwner(
  db: Queryable,
  params: { vaultId: string; ownerWalletId: string },
): Promise<VaultRow | null> {
  const result = await db.query('SELECT * FROM vaults WHERE id = $1 AND owner_wallet_id = $2', [
    params.vaultId,
    params.ownerWalletId,
  ]);
  const row = result.rows[0];
  return row ? mapVaultRow(row) : null;
}

export interface VaultWithDeployment extends VaultRow {
  chainId: bigint;
  environment: DeploymentRow['environment'];
}

/**
 * Joins the vault to its deployment so the session's verified SIWE chain can be checked against
 * the chain reached THROUGH the resource. Checking against a request-supplied deploymentId would
 * let a caller satisfy the check by naming any matching-chain deployment they do not own.
 */
export async function getVaultWithDeployment(
  db: Queryable,
  vaultId: string,
): Promise<VaultWithDeployment | null> {
  const result = await db.query(
    `SELECT v.*, d.chain_id, d.environment
     FROM vaults v JOIN deployments d ON d.id = v.deployment_id
     WHERE v.id = $1`,
    [vaultId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...mapVaultRow(row),
    chainId: BigInt(row.chain_id as string),
    environment: row.environment as DeploymentRow['environment'],
  };
}

/**
 * Owner-scoped keyset page. `vaults` has no `created_at` column, so the key is (owner_wallet_id,
 * id) -- exactly the existing `vaults_owner` index. The owner id is the authorization boundary and
 * is never taken from the cursor: a cursor can only ever move the caller forward within their own
 * set, never widen it.
 */
export async function getVaultsKeysetForOwner(
  db: Queryable,
  params: { ownerWalletId: string; afterId?: string; limit: number },
): Promise<VaultRow[]> {
  const values: unknown[] = [params.ownerWalletId];
  let cursorClause = '';
  if (params.afterId !== undefined) {
    values.push(params.afterId);
    cursorClause = ` AND id > $${values.length}`;
  }
  values.push(params.limit);
  const result = await db.query(
    `SELECT * FROM vaults WHERE owner_wallet_id = $1${cursorClause} ORDER BY id LIMIT $${values.length}`,
    values,
  );
  return result.rows.map(mapVaultRow);
}
