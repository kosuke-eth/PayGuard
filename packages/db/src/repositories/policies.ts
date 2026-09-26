/**
 * Policy drafts, immutable compiled revisions, and observed on-chain policies (Stage 4).
 *
 * A draft carries no chain authority at all -- it is owner-editable working state. The moment it
 * is compiled into transaction bytes, those bytes are archived as an IMMUTABLE revision keyed
 * (draft_id, draft_version): editing afterwards creates a new revision rather than mutating the
 * bytes an owner already reviewed. A `policies` row only ever describes what was actually observed
 * on chain; nothing here activates a policy.
 *
 * `canonical_config_bytes` is the authoritative configuration (it is what re-hashes to the on-chain
 * configHash). `config_projection` is a convenience JSONB read and is never the source of truth --
 * notably `allowedCategoryBitmap` has no normalized column at all.
 */
import type pg from 'pg';
import type { Queryable } from '../pool.js';

// --- drafts ---------------------------------------------------------------------------------

export interface PolicyDraftRow {
  id: string;
  vaultId: string;
  draftVersion: bigint;
  body: unknown;
  compiledBytes: Buffer | null;
  compiledHash: Buffer | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapDraftRow(row: Record<string, unknown>): PolicyDraftRow {
  return {
    id: row.id as string,
    vaultId: row.vault_id as string,
    draftVersion: BigInt(row.draft_version as string),
    body: row.body,
    compiledBytes: (row.compiled_bytes as Buffer | null) ?? null,
    compiledHash: (row.compiled_hash as Buffer | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export async function createPolicyDraft(
  client: pg.PoolClient,
  params: { id: string; vaultId: string; body: unknown },
): Promise<PolicyDraftRow> {
  const result = await client.query(
    `INSERT INTO policy_drafts (id, vault_id, draft_version, body)
     VALUES ($1,$2,1,$3)
     RETURNING *`,
    [params.id, params.vaultId, JSON.stringify(params.body)],
  );
  const row = result.rows[0];
  if (!row) throw new Error('createPolicyDraft: INSERT ... RETURNING produced no row');
  return mapDraftRow(row);
}

export async function getPolicyDraftById(
  db: Queryable,
  id: string,
): Promise<PolicyDraftRow | null> {
  const result = await db.query('SELECT * FROM policy_drafts WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapDraftRow(row) : null;
}

/**
 * Optimistic-concurrency edit. A 0-row result means someone else advanced the draft between the
 * caller's read and this write, which the API surfaces as 409 DRAFT_VERSION_CONFLICT rather than
 * silently overwriting a concurrent edit.
 */
export async function updatePolicyDraft(
  client: pg.PoolClient,
  params: { id: string; expectedVersion: bigint; body: unknown },
): Promise<{ updated: boolean; row: PolicyDraftRow | null }> {
  const result = await client.query(
    `UPDATE policy_drafts
     SET body = $3, draft_version = draft_version + 1, updated_at = now()
     WHERE id = $1 AND draft_version = $2
     RETURNING *`,
    [params.id, params.expectedVersion.toString(10), JSON.stringify(params.body)],
  );
  const row = result.rows[0];
  return { updated: !!row, row: row ? mapDraftRow(row) : null };
}

export interface PolicyDraftRevisionRow {
  draftId: string;
  draftVersion: bigint;
  canonicalBody: unknown;
  encodedTransaction: Buffer;
  transactionDigest: Buffer;
  createdAt: Date;
}

function mapRevisionRow(row: Record<string, unknown>): PolicyDraftRevisionRow {
  return {
    draftId: row.draft_id as string,
    draftVersion: BigInt(row.draft_version as string),
    canonicalBody: row.canonical_body,
    encodedTransaction: row.encoded_transaction as Buffer,
    transactionDigest: row.transaction_digest as Buffer,
    createdAt: row.created_at as Date,
  };
}

export type ArchiveRevisionResult =
  | { kind: 'created'; row: PolicyDraftRevisionRow }
  /** This exact version was already compiled; the SAME bytes are returned, never re-encoded. */
  | { kind: 'existing'; row: PolicyDraftRevisionRow };

/**
 * Archives compiled transaction bytes for one specific draft version. The primary key
 * (draft_id, draft_version) IS the compare-and-set: a second compile of the same version cannot
 * overwrite the bytes an owner already reviewed, it returns the original ones.
 */
export async function archiveDraftRevision(
  client: pg.PoolClient,
  params: {
    draftId: string;
    draftVersion: bigint;
    canonicalBody: unknown;
    encodedTransaction: Buffer;
    transactionDigest: Buffer;
  },
): Promise<ArchiveRevisionResult> {
  const inserted = await client.query(
    `INSERT INTO policy_draft_revisions (draft_id, draft_version, canonical_body, encoded_transaction, transaction_digest)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (draft_id, draft_version) DO NOTHING
     RETURNING *`,
    [
      params.draftId,
      params.draftVersion.toString(10),
      JSON.stringify(params.canonicalBody),
      params.encodedTransaction,
      params.transactionDigest,
    ],
  );
  if (inserted.rows[0]) return { kind: 'created', row: mapRevisionRow(inserted.rows[0]) };

  const existing = await client.query(
    'SELECT * FROM policy_draft_revisions WHERE draft_id = $1 AND draft_version = $2',
    [params.draftId, params.draftVersion.toString(10)],
  );
  const row = existing.rows[0];
  if (!row) throw new Error('archiveDraftRevision: conflict but no existing row found (race?)');
  return { kind: 'existing', row: mapRevisionRow(row) };
}

export async function getLatestDraftRevision(
  db: Queryable,
  draftId: string,
): Promise<PolicyDraftRevisionRow | null> {
  const result = await db.query(
    'SELECT * FROM policy_draft_revisions WHERE draft_id = $1 ORDER BY draft_version DESC LIMIT 1',
    [draftId],
  );
  const row = result.rows[0];
  return row ? mapRevisionRow(row) : null;
}

export async function getDraftRevision(
  db: Queryable,
  params: { draftId: string; draftVersion: bigint },
): Promise<PolicyDraftRevisionRow | null> {
  const result = await db.query(
    'SELECT * FROM policy_draft_revisions WHERE draft_id = $1 AND draft_version = $2',
    [params.draftId, params.draftVersion.toString(10)],
  );
  const row = result.rows[0];
  return row ? mapRevisionRow(row) : null;
}

/** Records the compiled bytes on the draft itself so the latest compile is cheap to find. */
export async function markDraftCompiled(
  client: pg.PoolClient,
  params: { id: string; compiledBytes: Buffer; compiledHash: Buffer },
): Promise<void> {
  await client.query(
    'UPDATE policy_drafts SET compiled_bytes = $2, compiled_hash = $3, updated_at = now() WHERE id = $1',
    [params.id, params.compiledBytes, params.compiledHash],
  );
}

// --- observed policies ----------------------------------------------------------------------

export type ObservedPolicyStatus = 'ACTIVE' | 'REVOKED' | 'SUPERSEDED' | 'EXPIRED' | 'ORPHANED';

export interface PolicyRow {
  id: string;
  vaultId: string;
  onchainPolicyId: Buffer;
  agent: Buffer;
  inputToken: Buffer;
  settlementToken: Buffer;
  adapter: Buffer;
  routeId: Buffer;
  totalOutputBudget: bigint;
  epochOutputBudget: bigint;
  automaticOutputCap: bigint;
  escalationOutputCap: bigint;
  totalInputBudget: bigint;
  maxInputPerPayment: bigint;
  validAfter: bigint;
  validUntil: bigint;
  subsidyMode: number;
  canonicalConfigBytes: Buffer;
  configProjection: unknown;
  observedStatus: ObservedPolicyStatus;
  observedBlockHash: Buffer;
}

function mapPolicyRow(row: Record<string, unknown>): PolicyRow {
  return {
    id: row.id as string,
    vaultId: row.vault_id as string,
    onchainPolicyId: row.onchain_policy_id as Buffer,
    agent: row.agent as Buffer,
    inputToken: row.input_token as Buffer,
    settlementToken: row.settlement_token as Buffer,
    adapter: row.adapter as Buffer,
    routeId: row.route_id as Buffer,
    totalOutputBudget: BigInt(row.total_output_budget as string),
    epochOutputBudget: BigInt(row.epoch_output_budget as string),
    automaticOutputCap: BigInt(row.automatic_output_cap as string),
    escalationOutputCap: BigInt(row.escalation_output_cap as string),
    totalInputBudget: BigInt(row.total_input_budget as string),
    maxInputPerPayment: BigInt(row.max_input_per_payment as string),
    validAfter: BigInt(row.valid_after as string),
    validUntil: BigInt(row.valid_until as string),
    subsidyMode: Number(row.subsidy_mode),
    canonicalConfigBytes: row.canonical_config_bytes as Buffer,
    configProjection: row.config_projection,
    observedStatus: row.observed_status as ObservedPolicyStatus,
    observedBlockHash: row.observed_block_hash as Buffer,
  };
}

export interface CreatePolicyParams {
  id: string;
  vaultId: string;
  onchainPolicyId: Buffer;
  agent: Buffer;
  inputToken: Buffer;
  settlementToken: Buffer;
  adapter: Buffer;
  routeId: Buffer;
  totalOutputBudget: bigint;
  epochOutputBudget: bigint;
  automaticOutputCap: bigint;
  escalationOutputCap: bigint;
  totalInputBudget: bigint;
  maxInputPerPayment: bigint;
  validAfter: bigint;
  validUntil: bigint;
  subsidyMode: number;
  canonicalConfigBytes: Buffer;
  configProjection: unknown;
  observedStatus: ObservedPolicyStatus;
  observedBlockHash: Buffer;
}

export type CreatePolicyResult =
  | { kind: 'created'; row: PolicyRow }
  | { kind: 'existing'; row: PolicyRow };

/**
 * Records a policy that was OBSERVED on chain. Idempotent on the real identity
 * (vault_id, onchain_policy_id), so re-observing the same creation never produces a second row.
 */
export async function recordObservedPolicy(
  client: pg.PoolClient,
  params: CreatePolicyParams,
): Promise<CreatePolicyResult> {
  const values = [
    params.id,
    params.vaultId,
    params.onchainPolicyId,
    params.agent,
    params.inputToken,
    params.settlementToken,
    params.adapter,
    params.routeId,
    params.totalOutputBudget.toString(10),
    params.epochOutputBudget.toString(10),
    params.automaticOutputCap.toString(10),
    params.escalationOutputCap.toString(10),
    params.totalInputBudget.toString(10),
    params.maxInputPerPayment.toString(10),
    params.validAfter.toString(10),
    params.validUntil.toString(10),
    params.subsidyMode,
    params.canonicalConfigBytes,
    JSON.stringify(params.configProjection),
    params.observedStatus,
    params.observedBlockHash,
  ];
  const inserted = await client.query(
    `INSERT INTO policies (
       id, vault_id, onchain_policy_id, agent, input_token, settlement_token, adapter, route_id,
       total_output_budget, epoch_output_budget, automatic_output_cap, escalation_output_cap,
       total_input_budget, max_input_per_payment, valid_after, valid_until, subsidy_mode,
       canonical_config_bytes, config_projection, observed_status, observed_block_hash
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (vault_id, onchain_policy_id) DO NOTHING
     RETURNING *`,
    values,
  );
  if (inserted.rows[0]) return { kind: 'created', row: mapPolicyRow(inserted.rows[0]) };

  const existing = await client.query(
    'SELECT * FROM policies WHERE vault_id = $1 AND onchain_policy_id = $2',
    [params.vaultId, params.onchainPolicyId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error('recordObservedPolicy: conflict but no existing row found (race?)');
  return { kind: 'existing', row: mapPolicyRow(row) };
}

export async function getPolicyById(db: Queryable, id: string): Promise<PolicyRow | null> {
  const result = await db.query('SELECT * FROM policies WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapPolicyRow(row) : null;
}

export async function getPoliciesByVault(db: Queryable, vaultId: string): Promise<PolicyRow[]> {
  const result = await db.query(
    'SELECT * FROM policies WHERE vault_id = $1 ORDER BY onchain_policy_id',
    [vaultId],
  );
  return result.rows.map(mapPolicyRow);
}

/**
 * Agent binding lookup, used to decide whether a session wallet is a "bound agent" of a vault.
 * Restricted to ACTIVE policies so a superseded or revoked binding never keeps granting read
 * access after the owner rotated it.
 */
export async function getActivePoliciesForAgent(
  db: Queryable,
  params: { agent: Buffer },
): Promise<PolicyRow[]> {
  const result = await db.query(
    "SELECT * FROM policies WHERE agent = $1 AND observed_status = 'ACTIVE' ORDER BY id",
    [params.agent],
  );
  return result.rows.map(mapPolicyRow);
}

export interface PolicyMerchantRow {
  policyId: string;
  merchantId: Buffer;
  recipient: Buffer;
  invoiceSigner: Buffer;
  category: number;
  displayMetadata: unknown;
}

function mapMerchantRow(row: Record<string, unknown>): PolicyMerchantRow {
  return {
    policyId: row.policy_id as string,
    merchantId: row.merchant_id as Buffer,
    recipient: row.recipient as Buffer,
    invoiceSigner: row.invoice_signer as Buffer,
    category: Number(row.category),
    displayMetadata: row.display_metadata,
  };
}

export async function insertPolicyMerchants(
  client: pg.PoolClient,
  params: {
    policyId: string;
    merchants: ReadonlyArray<{
      merchantId: Buffer;
      recipient: Buffer;
      invoiceSigner: Buffer;
      category: number;
      displayMetadata?: unknown;
    }>;
  },
): Promise<void> {
  for (const merchant of params.merchants) {
    await client.query(
      `INSERT INTO policy_merchants (policy_id, merchant_id, recipient, invoice_signer, category, display_metadata)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (policy_id, merchant_id) DO NOTHING`,
      [
        params.policyId,
        merchant.merchantId,
        merchant.recipient,
        merchant.invoiceSigner,
        merchant.category,
        JSON.stringify(merchant.displayMetadata ?? {}),
      ],
    );
  }
}

export async function supersedeActivePoliciesForAgent(
  client: pg.PoolClient,
  params: { vaultId: string; agent: Buffer; exceptPolicyId: string },
): Promise<number> {
  const result = await client.query(
    `UPDATE policies
     SET observed_status = 'SUPERSEDED'
     WHERE vault_id = $1 AND agent = $2 AND observed_status = 'ACTIVE' AND id <> $3`,
    [params.vaultId, params.agent, params.exceptPolicyId],
  );
  return result.rowCount ?? 0;
}

export async function getPolicyMerchants(
  db: Queryable,
  policyId: string,
): Promise<PolicyMerchantRow[]> {
  const result = await db.query(
    'SELECT * FROM policy_merchants WHERE policy_id = $1 ORDER BY merchant_id',
    [policyId],
  );
  return result.rows.map(mapMerchantRow);
}

/**
 * Invoice-ingestion validity check (SPEC-016): does this vault have ANY merchant snapshot whose
 * merchantId and invoiceSigner match what an invoice claims?
 *
 * This establishes that the invoice was signed by a merchant the owner has actually configured
 * somewhere on this vault. It deliberately does NOT decide permission under a specific policy
 * (that is re-checked at intent creation and again on chain), and it confers NO read access to
 * anything -- merchant read scope is per-payment, resolved through the invoice's own signer.
 */
export async function findMerchantSnapshotForVault(
  db: Queryable,
  params: { vaultId: string; merchantId: Buffer; invoiceSigner: Buffer },
): Promise<PolicyMerchantRow | null> {
  const result = await db.query(
    `SELECT pm.* FROM policy_merchants pm
     JOIN policies p ON p.id = pm.policy_id
     WHERE p.vault_id = $1 AND pm.merchant_id = $2 AND pm.invoice_signer = $3
     LIMIT 1`,
    [params.vaultId, params.merchantId, params.invoiceSigner],
  );
  const row = result.rows[0];
  return row ? mapMerchantRow(row) : null;
}
