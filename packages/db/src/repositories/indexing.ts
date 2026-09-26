/**
 * Canonical/orphan block-receipt-event replay storage, indexer cursors, and owner-filtered
 * keyset queries (Prompt 3 item 7). Events dedup by (deployment_id, block_hash, log_index) --
 * never by tx_hash alone, since one transaction can emit many logs.
 */
import type pg from 'pg';
import type { Queryable } from '../pool.js';

// --- chain_blocks -----------------------------------------------------------------------------

export interface ChainBlockRow {
  deploymentId: string;
  blockHash: Buffer;
  blockNumber: bigint;
  parentHash: Buffer;
  canonical: boolean;
  confidence: string;
  observedAt: Date;
}

function mapBlockRow(row: Record<string, unknown>): ChainBlockRow {
  return {
    deploymentId: row.deployment_id as string,
    blockHash: row.block_hash as Buffer,
    blockNumber: BigInt(row.block_number as string),
    parentHash: row.parent_hash as Buffer,
    canonical: row.canonical as boolean,
    confidence: row.confidence as string,
    observedAt: row.observed_at as Date,
  };
}

export type RecordBlockResult =
  | { kind: 'created'; row: ChainBlockRow }
  | { kind: 'existing'; row: ChainBlockRow };

export async function recordBlock(
  client: pg.PoolClient,
  params: {
    deploymentId: string;
    blockHash: Buffer;
    blockNumber: bigint;
    parentHash: Buffer;
    canonical: boolean;
    confidence: string;
  },
): Promise<RecordBlockResult> {
  const inserted = await client.query(
    `INSERT INTO chain_blocks (deployment_id, block_hash, block_number, parent_hash, canonical, confidence)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (deployment_id, block_hash) DO NOTHING
     RETURNING *`,
    [
      params.deploymentId,
      params.blockHash,
      params.blockNumber.toString(10),
      params.parentHash,
      params.canonical,
      params.confidence,
    ],
  );
  if (inserted.rows[0]) return { kind: 'created', row: mapBlockRow(inserted.rows[0]) };
  const existing = await client.query(
    'SELECT * FROM chain_blocks WHERE deployment_id = $1 AND block_hash = $2',
    [params.deploymentId, params.blockHash],
  );
  const row = existing.rows[0];
  if (!row) throw new Error('recordBlock: conflict but no existing row found (race?)');
  return { kind: 'existing', row: mapBlockRow(row) };
}

/** The block WE currently consider canonical at a height -- the walk-back comparison point for reorg detection. */
export async function getCanonicalBlockAtHeight(
  db: Queryable,
  params: { deploymentId: string; blockNumber: bigint },
): Promise<ChainBlockRow | null> {
  const result = await db.query(
    'SELECT * FROM chain_blocks WHERE deployment_id = $1 AND block_number = $2 AND canonical = true',
    [params.deploymentId, params.blockNumber.toString(10)],
  );
  const row = result.rows[0];
  return row ? mapBlockRow(row) : null;
}

/**
 * The highest canonical block WE have recorded, from ANY writer -- not only the indexer's own
 * forward scan. `reconcileAttempt` (reconcile.ts) writes a canonical block synchronously at the
 * exact height of a settlement it observed, independent of and often ahead of the indexer's own
 * cursor. Reorg detection anchored only to the cursor's own frontier misses a divergence at one of
 * these out-of-band-ahead heights entirely (SPEC-034); anchoring to this instead subsumes the
 * cursor's own frontier as a special case (the indexer's own last write is always <= this).
 */
export async function getMaxCanonicalBlock(
  db: Queryable,
  params: { deploymentId: string },
): Promise<ChainBlockRow | null> {
  const result = await db.query(
    'SELECT * FROM chain_blocks WHERE deployment_id = $1 AND canonical = true ORDER BY block_number DESC LIMIT 1',
    [params.deploymentId],
  );
  const row = result.rows[0];
  return row ? mapBlockRow(row) : null;
}

// --- receipts ---------------------------------------------------------------------------------

export interface ReceiptRow {
  deploymentId: string;
  txHash: Buffer;
  blockHash: Buffer;
  receiptStatus: 0 | 1;
  canonical: boolean;
  rawReceipt: unknown;
}

function mapReceiptRow(row: Record<string, unknown>): ReceiptRow {
  return {
    deploymentId: row.deployment_id as string,
    txHash: row.tx_hash as Buffer,
    blockHash: row.block_hash as Buffer,
    receiptStatus: row.receipt_status as 0 | 1,
    canonical: row.canonical as boolean,
    rawReceipt: row.raw_receipt,
  };
}

export async function recordReceipt(
  client: pg.PoolClient,
  params: {
    deploymentId: string;
    txHash: Buffer;
    blockHash: Buffer;
    receiptStatus: 0 | 1;
    canonical: boolean;
    rawReceipt: unknown;
  },
): Promise<{ kind: 'created' | 'existing'; row: ReceiptRow }> {
  const inserted = await client.query(
    `INSERT INTO receipts (deployment_id, tx_hash, block_hash, receipt_status, canonical, raw_receipt)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (deployment_id, tx_hash, block_hash) DO NOTHING
     RETURNING *`,
    [
      params.deploymentId,
      params.txHash,
      params.blockHash,
      params.receiptStatus,
      params.canonical,
      JSON.stringify(params.rawReceipt),
    ],
  );
  if (inserted.rows[0]) return { kind: 'created', row: mapReceiptRow(inserted.rows[0]) };
  const existing = await client.query(
    'SELECT * FROM receipts WHERE deployment_id = $1 AND tx_hash = $2 AND block_hash = $3',
    [params.deploymentId, params.txHash, params.blockHash],
  );
  const row = existing.rows[0];
  if (!row) throw new Error('recordReceipt: conflict but no existing row found (race?)');
  return { kind: 'existing', row: mapReceiptRow(row) };
}

// --- chain_events -----------------------------------------------------------------------------

export interface ChainEventRow {
  deploymentId: string;
  blockHash: Buffer;
  logIndex: bigint;
  txHash: Buffer;
  emitter: Buffer;
  topic0: Buffer;
  topics: unknown;
  data: Buffer;
  decodedName: string | null;
  decodedPayload: unknown;
  canonical: boolean;
}

function mapEventRow(row: Record<string, unknown>): ChainEventRow {
  return {
    deploymentId: row.deployment_id as string,
    blockHash: row.block_hash as Buffer,
    logIndex: BigInt(row.log_index as string),
    txHash: row.tx_hash as Buffer,
    emitter: row.emitter as Buffer,
    topic0: row.topic0 as Buffer,
    topics: row.topics,
    data: row.data as Buffer,
    decodedName: (row.decoded_name as string | null) ?? null,
    decodedPayload: row.decoded_payload ?? null,
    canonical: row.canonical as boolean,
  };
}

/** Dedup key is (deployment_id, block_hash, log_index) -- NOT tx_hash, which can repeat within one tx. */
export async function recordEvent(
  client: pg.PoolClient,
  params: {
    deploymentId: string;
    blockHash: Buffer;
    logIndex: bigint;
    txHash: Buffer;
    emitter: Buffer;
    topic0: Buffer;
    topics: unknown;
    data: Buffer;
    decodedName?: string;
    decodedPayload?: unknown;
    canonical: boolean;
  },
): Promise<{ kind: 'created' | 'existing'; row: ChainEventRow }> {
  const inserted = await client.query(
    `INSERT INTO chain_events (deployment_id, block_hash, log_index, tx_hash, emitter, topic0, topics, data, decoded_name, decoded_payload, canonical)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (deployment_id, block_hash, log_index) DO NOTHING
     RETURNING *`,
    [
      params.deploymentId,
      params.blockHash,
      params.logIndex.toString(10),
      params.txHash,
      params.emitter,
      params.topic0,
      JSON.stringify(params.topics),
      params.data,
      params.decodedName ?? null,
      params.decodedPayload !== undefined ? JSON.stringify(params.decodedPayload) : null,
      params.canonical,
    ],
  );
  if (inserted.rows[0]) return { kind: 'created', row: mapEventRow(inserted.rows[0]) };
  const existing = await client.query(
    'SELECT * FROM chain_events WHERE deployment_id = $1 AND block_hash = $2 AND log_index = $3',
    [params.deploymentId, params.blockHash, params.logIndex.toString(10)],
  );
  const row = existing.rows[0];
  if (!row) throw new Error('recordEvent: conflict but no existing row found (race?)');
  return { kind: 'existing', row: mapEventRow(row) };
}

export async function getEventsByTx(
  db: Queryable,
  params: { deploymentId: string; txHash: Buffer },
): Promise<ChainEventRow[]> {
  const result = await db.query(
    'SELECT * FROM chain_events WHERE deployment_id = $1 AND tx_hash = $2 ORDER BY log_index',
    [params.deploymentId, params.txHash],
  );
  return result.rows.map(mapEventRow);
}

/**
 * Reorg handling: demotes every block/receipt/event in `orphanedBlockHashes` to non-canonical,
 * then promotes the new winning block (and its already-recorded receipts/events) to canonical --
 * all in the caller's one transaction, matching ARCH 3.4's "Updating branch canonicality and the
 * dependent read model occurs in one SQL transaction."
 */
export async function reorgToBlock(
  client: pg.PoolClient,
  params: { deploymentId: string; orphanedBlockHashes: Buffer[]; newCanonicalBlockHash: Buffer },
): Promise<void> {
  if (params.orphanedBlockHashes.length > 0) {
    await client.query(
      'UPDATE chain_blocks SET canonical = false WHERE deployment_id = $1 AND block_hash = ANY($2::bytea[])',
      [params.deploymentId, params.orphanedBlockHashes],
    );
    await client.query(
      'UPDATE receipts SET canonical = false WHERE deployment_id = $1 AND block_hash = ANY($2::bytea[])',
      [params.deploymentId, params.orphanedBlockHashes],
    );
    await client.query(
      'UPDATE chain_events SET canonical = false WHERE deployment_id = $1 AND block_hash = ANY($2::bytea[])',
      [params.deploymentId, params.orphanedBlockHashes],
    );
  }
  await client.query(
    'UPDATE chain_blocks SET canonical = true WHERE deployment_id = $1 AND block_hash = $2',
    [params.deploymentId, params.newCanonicalBlockHash],
  );
  await client.query(
    'UPDATE receipts SET canonical = true WHERE deployment_id = $1 AND block_hash = $2',
    [params.deploymentId, params.newCanonicalBlockHash],
  );
  await client.query(
    'UPDATE chain_events SET canonical = true WHERE deployment_id = $1 AND block_hash = $2',
    [params.deploymentId, params.newCanonicalBlockHash],
  );
}

/**
 * Finds every payment whose winning attempt's receipt lives in one of the blocks about to be
 * orphaned -- the join `reorgToBlock` itself does NOT perform (Stage 5 recovery table review,
 * finding 3: flipping `canonical` on `receipts`/`chain_events` alone regresses nothing on
 * `payments`). Callers must run this BEFORE calling `reorgToBlock` in the same transaction, using
 * its result to drive each affected payment's `executionStatus`/`confidence` back through the
 * graph-legal reorg edges (`INCLUDED|SUCCEEDED|REVERTED -> REORGED -> UNKNOWN`,
 * confidence `-> UNOBSERVED`) via `updatePaymentState`.
 */
export async function getPaymentsAffectedByOrphanedBlocks(
  db: Queryable,
  params: { deploymentId: string; orphanedBlockHashes: Buffer[] },
): Promise<Array<{ paymentId: string; attemptId: string; nonceFamilyId: string }>> {
  if (params.orphanedBlockHashes.length === 0) return [];
  const result = await db.query(
    `SELECT DISTINCT pi.payment_id AS payment_id, ta.id AS attempt_id, ta.nonce_family_id AS nonce_family_id
     FROM receipts r
     JOIN transaction_attempts ta ON ta.tx_hash = r.tx_hash AND ta.deployment_id = r.deployment_id
     JOIN nonce_families nf ON nf.id = ta.nonce_family_id
     JOIN payment_intents pi ON pi.id = nf.intent_id
     WHERE r.deployment_id = $1 AND r.block_hash = ANY($2::bytea[])`,
    [params.deploymentId, params.orphanedBlockHashes],
  );
  return result.rows.map((row) => ({
    paymentId: row.payment_id as string,
    attemptId: row.attempt_id as string,
    nonceFamilyId: row.nonce_family_id as string,
  }));
}

// --- indexer_cursors --------------------------------------------------------------------------

export interface IndexerCursorRow {
  deploymentId: string;
  contractGroup: string;
  nextBlock: bigint;
  lastCanonicalHash: Buffer | null;
  leaseVersion: bigint;
}

function mapCursorRow(row: Record<string, unknown>): IndexerCursorRow {
  return {
    deploymentId: row.deployment_id as string,
    contractGroup: row.contract_group as string,
    nextBlock: BigInt(row.next_block as string),
    lastCanonicalHash: (row.last_canonical_hash as Buffer | null) ?? null,
    leaseVersion: BigInt(row.lease_version as string),
  };
}

/** Creates the cursor on first use; thereafter a compare-and-set keyed on lease_version. */
export async function advanceCursor(
  client: pg.PoolClient,
  params: {
    deploymentId: string;
    contractGroup: string;
    nextBlock: bigint;
    lastCanonicalHash: Buffer | null;
    expectedLeaseVersion: bigint;
  },
): Promise<{ updated: boolean; row: IndexerCursorRow | null }> {
  const result = await client.query(
    `INSERT INTO indexer_cursors (deployment_id, contract_group, next_block, last_canonical_hash, lease_version)
     VALUES ($1,$2,$3,$4,1)
     ON CONFLICT (deployment_id, contract_group) DO UPDATE
       SET next_block = $3, last_canonical_hash = $4, lease_version = indexer_cursors.lease_version + 1
       WHERE indexer_cursors.lease_version = $5
     RETURNING *`,
    [
      params.deploymentId,
      params.contractGroup,
      params.nextBlock.toString(10),
      params.lastCanonicalHash,
      params.expectedLeaseVersion.toString(10),
    ],
  );
  const row = result.rows[0];
  return { updated: !!row, row: row ? mapCursorRow(row) : null };
}

export async function getCursor(
  db: Queryable,
  params: { deploymentId: string; contractGroup: string },
): Promise<IndexerCursorRow | null> {
  const result = await db.query(
    'SELECT * FROM indexer_cursors WHERE deployment_id = $1 AND contract_group = $2',
    [params.deploymentId, params.contractGroup],
  );
  const row = result.rows[0];
  return row ? mapCursorRow(row) : null;
}

// --- payment_timeline -------------------------------------------------------------------------

export interface TimelineEventRow {
  id: string;
  paymentId: string;
  eventKey: string;
  eventType: string;
  body: unknown;
  createdAt: Date;
}

function mapTimelineRow(row: Record<string, unknown>): TimelineEventRow {
  return {
    id: row.id as string,
    paymentId: row.payment_id as string,
    eventKey: row.event_key as string,
    eventType: row.event_type as string,
    body: row.body,
    createdAt: row.created_at as Date,
  };
}

export async function insertTimelineEvent(
  client: pg.PoolClient,
  params: { id: string; paymentId: string; eventKey: string; eventType: string; body: unknown },
): Promise<{ kind: 'created' | 'existing'; row: TimelineEventRow }> {
  const inserted = await client.query(
    `INSERT INTO payment_timeline (id, payment_id, event_key, event_type, body)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (event_key) DO NOTHING
     RETURNING *`,
    [params.id, params.paymentId, params.eventKey, params.eventType, JSON.stringify(params.body)],
  );
  if (inserted.rows[0]) return { kind: 'created', row: mapTimelineRow(inserted.rows[0]) };
  const existing = await client.query('SELECT * FROM payment_timeline WHERE event_key = $1', [
    params.eventKey,
  ]);
  const row = existing.rows[0];
  if (!row) throw new Error('insertTimelineEvent: conflict but no existing row found (race?)');
  return { kind: 'existing', row: mapTimelineRow(row) };
}

export async function getPaymentTimelineKeyset(
  db: Queryable,
  params: { paymentId: string; afterCreatedAt?: Date; afterId?: string; limit: number },
): Promise<TimelineEventRow[]> {
  const result =
    params.afterCreatedAt && params.afterId
      ? await db.query(
          `SELECT * FROM payment_timeline
           WHERE payment_id = $1 AND (created_at, id) > ($2, $3)
           ORDER BY created_at, id LIMIT $4`,
          [params.paymentId, params.afterCreatedAt, params.afterId, params.limit],
        )
      : await db.query(
          'SELECT * FROM payment_timeline WHERE payment_id = $1 ORDER BY created_at, id LIMIT $2',
          [params.paymentId, params.limit],
        );
  return result.rows.map(mapTimelineRow);
}

/**
 * Owner-filtered keyset pagination: `vaultIds` is the authorization boundary (the caller must
 * have already resolved it from the authenticated wallet's own vaults), not something the cursor
 * can widen -- a cursor only ever moves the window forward within that fixed vault set.
 */
export async function getPaymentsKeysetForVaults(
  db: Queryable,
  params: {
    vaultIds: string[];
    afterCreatedAt?: Date;
    afterId?: string;
    status?: string;
    limit: number;
  },
): Promise<Array<{ id: string; vaultId: string; executionStatus: string; createdAt: Date }>> {
  const conditions: string[] = ['vault_id = ANY($1::uuid[])'];
  const values: unknown[] = [params.vaultIds];
  if (params.status) {
    conditions.push(`execution_status = $${values.length + 1}`);
    values.push(params.status);
  }
  if (params.afterCreatedAt && params.afterId) {
    conditions.push(`(created_at, id) > ($${values.length + 1}, $${values.length + 2})`);
    values.push(params.afterCreatedAt, params.afterId);
  }
  values.push(params.limit);
  const result = await db.query(
    `SELECT id, vault_id, execution_status, created_at FROM payments
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at, id LIMIT $${values.length}`,
    values,
  );
  return result.rows.map((row) => ({
    id: row.id as string,
    vaultId: row.vault_id as string,
    executionStatus: row.execution_status as string,
    createdAt: row.created_at as Date,
  }));
}

/**
 * Merchant-scoped keyset pagination (Stage 4).
 *
 * A merchant's authorization boundary is NOT the vault. Being listed as an `invoice_signer` in
 * some policy snapshot of vault V would match every payment in V, which would hand merchant A
 * merchant B's payment outcomes. The real boundary is per-payment: the caller must be the signer
 * of that payment's own invoice artifact, so this scopes on `signed_artifacts.signer` reached
 * through the payment's invoice.
 *
 * As with the vault-scoped variant, `invoiceSigner` comes from the authenticated session and can
 * never be supplied or widened by the cursor.
 */
export async function getPaymentsKeysetForInvoiceSigner(
  db: Queryable,
  params: {
    invoiceSigner: Buffer;
    afterCreatedAt?: Date;
    afterId?: string;
    status?: string;
    limit: number;
  },
): Promise<Array<{ id: string; vaultId: string; executionStatus: string; createdAt: Date }>> {
  const conditions: string[] = ['sa.signer = $1', "sa.kind = 'INVOICE'"];
  const values: unknown[] = [params.invoiceSigner];
  if (params.status) {
    conditions.push(`p.execution_status = $${values.length + 1}`);
    values.push(params.status);
  }
  if (params.afterCreatedAt && params.afterId) {
    conditions.push(`(p.created_at, p.id) > ($${values.length + 1}, $${values.length + 2})`);
    values.push(params.afterCreatedAt, params.afterId);
  }
  values.push(params.limit);
  const result = await db.query(
    `SELECT p.id, p.vault_id, p.execution_status, p.created_at
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     JOIN signed_artifacts sa ON sa.id = i.artifact_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY p.created_at, p.id LIMIT $${values.length}`,
    values,
  );
  return result.rows.map((row) => ({
    id: row.id as string,
    vaultId: row.vault_id as string,
    executionStatus: row.execution_status as string,
    createdAt: row.created_at as Date,
  }));
}

/**
 * Resolves whether a specific payment's invoice was signed by this wallet -- the per-resource
 * merchant predicate for `GET /v1/payments/{id}`. Returns false for a payment that exists but
 * belongs to a different merchant, so a known UUID alone grants nothing.
 */
export async function isInvoiceSignerOfPayment(
  db: Queryable,
  params: { paymentId: string; signer: Buffer },
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     JOIN signed_artifacts sa ON sa.id = i.artifact_id
     WHERE p.id = $1 AND sa.signer = $2 AND sa.kind = 'INVOICE'
     LIMIT 1`,
    [params.paymentId, params.signer],
  );
  return result.rows.length > 0;
}
