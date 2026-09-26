/**
 * Signed evidence storage (invoices/intents/approvals). Rows are insert-once, append-only --
 * migration 0002's `signed_artifacts_immutable` trigger rejects any UPDATE at the SQL layer, so
 * this repository deliberately exposes no update function at all.
 */
import type pg from 'pg';
import type { Queryable } from '../pool.js';

export interface SignedArtifactRow {
  id: string;
  kind: 'INVOICE' | 'INTENT' | 'APPROVAL';
  digest: Buffer;
  signer: Buffer;
  encodedPayload: Buffer;
  typedData: unknown;
  signature: Buffer;
  signatureHash: Buffer;
  schemaVersion: string;
  createdAt: Date;
}

function mapRow(row: Record<string, unknown>): SignedArtifactRow {
  return {
    id: row.id as string,
    kind: row.kind as SignedArtifactRow['kind'],
    digest: row.digest as Buffer,
    signer: row.signer as Buffer,
    encodedPayload: row.encoded_payload as Buffer,
    typedData: row.typed_data,
    signature: row.signature as Buffer,
    signatureHash: row.signature_hash as Buffer,
    schemaVersion: row.schema_version as string,
    createdAt: row.created_at as Date,
  };
}

/**
 * Insert-once, idempotent on (kind, digest, signature_hash) -- the same UNIQUE constraint that
 * backs it. A caller resubmitting a byte-identical signed artifact (e.g. a client retry after a
 * network blip, or the invoice-identity idempotent-resubmit path) must observe the ORIGINAL row,
 * never a unique-violation 500: `ON CONFLICT DO NOTHING` plus a fallback read is the same
 * CAS-readback discipline used throughout this package (see txJournal.ts), not a plain INSERT.
 */
export async function createSignedArtifact(
  client: pg.PoolClient,
  params: {
    id: string;
    kind: 'INVOICE' | 'INTENT' | 'APPROVAL';
    digest: Buffer;
    signer: Buffer;
    encodedPayload: Buffer;
    typedData: unknown;
    signature: Buffer;
    signatureHash: Buffer;
    schemaVersion: string;
  },
): Promise<SignedArtifactRow> {
  const inserted = await client.query(
    `INSERT INTO signed_artifacts (id, kind, digest, signer, encoded_payload, typed_data, signature, signature_hash, schema_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (kind, digest, signature_hash) DO NOTHING
     RETURNING *`,
    [
      params.id,
      params.kind,
      params.digest,
      params.signer,
      params.encodedPayload,
      JSON.stringify(params.typedData),
      params.signature,
      params.signatureHash,
      params.schemaVersion,
    ],
  );
  if (inserted.rows[0]) return mapRow(inserted.rows[0]);

  const existing = await client.query(
    'SELECT * FROM signed_artifacts WHERE kind = $1 AND digest = $2 AND signature_hash = $3',
    [params.kind, params.digest, params.signatureHash],
  );
  const row = existing.rows[0];
  if (!row) throw new Error('createSignedArtifact: conflicting row vanished before readback');
  return mapRow(row);
}

export async function getSignedArtifactById(
  db: Queryable,
  id: string,
): Promise<SignedArtifactRow | null> {
  const result = await db.query('SELECT * FROM signed_artifacts WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}
