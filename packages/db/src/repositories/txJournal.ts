/**
 * Transaction journal: nonce-family allocation, immutable unsigned business-transaction intent,
 * signed raw bytes/hash, fee replacements, rebroadcast, and canonical-attempt closure -- as
 * distinct recoverable steps (Prompt 3 item 6). No network broadcast code here; this is the
 * durable-record layer the (later-stage) worker reads and writes around an actual RPC call.
 */
import type pg from 'pg';
import type { Queryable } from '../pool.js';
import {
  isTransactionAttemptStateTransitionAllowed,
  type TransactionAttemptState,
} from '../stateTransitions.js';

export class InvalidTransactionAttemptStateTransitionError extends Error {
  readonly from: TransactionAttemptState;
  readonly to: TransactionAttemptState;

  constructor(from: TransactionAttemptState, to: TransactionAttemptState) {
    super(`illegal transaction_attempts.state transition: ${from} -> ${to}`);
    this.name = 'InvalidTransactionAttemptStateTransitionError';
    this.from = from;
    this.to = to;
  }
}

// --- signer_state / nonce_families -----------------------------------------------------------

export interface NonceFamilyRow {
  id: string;
  deploymentId: string;
  sender: Buffer;
  nonce: bigint;
  intentId: string;
  unsignedRequest: unknown;
  expectedTo: Buffer;
  expectedCalldataHash: Buffer;
  canonicalTxHash: Buffer | null;
  closedAt: Date | null;
}

function mapNonceFamilyRow(row: Record<string, unknown>): NonceFamilyRow {
  return {
    id: row.id as string,
    deploymentId: row.deployment_id as string,
    sender: row.sender as Buffer,
    nonce: BigInt(row.nonce as string),
    intentId: row.intent_id as string,
    unsignedRequest: row.unsigned_request,
    expectedTo: row.expected_to as Buffer,
    expectedCalldataHash: row.expected_calldata_hash as Buffer,
    canonicalTxHash: (row.canonical_tx_hash as Buffer | null) ?? null,
    closedAt: (row.closed_at as Date | null) ?? null,
  };
}

/**
 * Locks the signer's `signer_state` row for the caller's whole transaction, without reading or
 * changing `next_nonce`. Recovery (SPEC-008: signing an already-reserved-but-unsigned family)
 * must hold this same lock across BOTH `recoverUnsignedFamilies` and the resulting
 * `recordSignedAttempt` calls -- not just around allocation like `reserveNonceFamily` does --
 * otherwise two workers recovering concurrently (a stalled-not-crashed outbox lease reclaimed by
 * a second worker, not necessarily a real process crash) can both observe the same "unsigned"
 * family and both sign+persist it, with no primitive to reconcile the loser (Stage 5 recovery
 * table review, finding 1). Creates the row first (matching `reserveNonceFamily`'s own upsert) so
 * recovery works even before any nonce has ever been allocated for this sender.
 */
export async function lockSigner(
  client: pg.PoolClient,
  params: { deploymentId: string; sender: Buffer },
): Promise<void> {
  await client.query(
    `INSERT INTO signer_state (deployment_id, sender, next_nonce) VALUES ($1,$2,0)
     ON CONFLICT (deployment_id, sender) DO NOTHING`,
    [params.deploymentId, params.sender],
  );
  await client.query(
    `SELECT 1 FROM signer_state WHERE deployment_id = $1 AND sender = $2 FOR UPDATE`,
    [params.deploymentId, params.sender],
  );
}

/**
 * Allocates the sender's next nonce and persists the immutable unsigned intent atomically, ahead
 * of any signing/broadcast. Locks the signer's own row for the duration -- "Serialize its nonce
 * allocation with one signer row/worker" (ARCH 3.4) -- so two concurrent reservations for the
 * same (deployment, sender) never receive the same nonce.
 */
export async function reserveNonceFamily(
  client: pg.PoolClient,
  params: {
    id: string;
    deploymentId: string;
    sender: Buffer;
    intentId: string;
    unsignedRequest: unknown;
    expectedTo: Buffer;
    expectedCalldataHash: Buffer;
  },
): Promise<NonceFamilyRow> {
  await client.query(
    `INSERT INTO signer_state (deployment_id, sender, next_nonce) VALUES ($1,$2,0)
     ON CONFLICT (deployment_id, sender) DO NOTHING`,
    [params.deploymentId, params.sender],
  );
  const signerState = await client.query<{ next_nonce: string }>(
    `SELECT next_nonce FROM signer_state WHERE deployment_id = $1 AND sender = $2 FOR UPDATE`,
    [params.deploymentId, params.sender],
  );
  const nextNonceRow = signerState.rows[0];
  if (!nextNonceRow) throw new Error('reserveNonceFamily: signer_state row missing after upsert');
  const nonce = BigInt(nextNonceRow.next_nonce);

  const inserted = await client.query(
    `INSERT INTO nonce_families (id, deployment_id, sender, nonce, intent_id, unsigned_request, expected_to, expected_calldata_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      params.id,
      params.deploymentId,
      params.sender,
      nonce.toString(10),
      params.intentId,
      JSON.stringify(params.unsignedRequest),
      params.expectedTo,
      params.expectedCalldataHash,
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('reserveNonceFamily: INSERT ... RETURNING produced no row');

  await client.query(
    `UPDATE signer_state SET next_nonce = $3, updated_at = now() WHERE deployment_id = $1 AND sender = $2`,
    [params.deploymentId, params.sender, (nonce + 1n).toString(10)],
  );

  return mapNonceFamilyRow(row);
}

/**
 * SPEC-008 recovery query, run on worker startup: an "allocated but unsigned" family is one with
 * no closed_at and no transaction_attempts row at all yet. Never allocate a new family for the
 * same intent to paper over a missing record -- reconstruct the same signed transaction from the
 * persisted unsigned_request instead.
 */
export async function recoverUnsignedFamilies(
  db: Queryable,
  params: { deploymentId: string; sender: Buffer },
): Promise<NonceFamilyRow[]> {
  const result = await db.query(
    `SELECT nf.* FROM nonce_families nf
     WHERE nf.deployment_id = $1 AND nf.sender = $2 AND nf.closed_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM transaction_attempts ta WHERE ta.nonce_family_id = nf.id)
     ORDER BY nf.nonce`,
    [params.deploymentId, params.sender],
  );
  return result.rows.map(mapNonceFamilyRow);
}

export async function getNonceFamilyById(
  db: Queryable,
  id: string,
): Promise<NonceFamilyRow | null> {
  const result = await db.query('SELECT * FROM nonce_families WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapNonceFamilyRow(row) : null;
}

/**
 * The intent's currently OPEN nonce family, if any -- `one_open_nonce_family_per_intent` (Stage 3
 * migration) guarantees at most one such row exists. Used by the worker's submit handler to decide
 * "resume an in-flight attempt" vs "start a fresh one" without re-deriving that decision from
 * scratch every invocation.
 */
export async function getOpenNonceFamilyForIntent(
  db: Queryable,
  intentId: string,
): Promise<NonceFamilyRow | null> {
  const result = await db.query(
    'SELECT * FROM nonce_families WHERE intent_id = $1 AND closed_at IS NULL',
    [intentId],
  );
  const row = result.rows[0];
  return row ? mapNonceFamilyRow(row) : null;
}

/** The most recently recorded attempt for a nonce family (fee replacements are newer rows). */
export async function getLatestAttemptForNonceFamily(
  db: Queryable,
  nonceFamilyId: string,
): Promise<TransactionAttemptRow | null> {
  const result = await db.query(
    'SELECT * FROM transaction_attempts WHERE nonce_family_id = $1 ORDER BY created_at DESC LIMIT 1',
    [nonceFamilyId],
  );
  const row = result.rows[0];
  return row ? mapAttemptRow(row) : null;
}

// --- transaction_attempts --------------------------------------------------------------------

export interface TransactionAttemptRow {
  id: string;
  deploymentId: string;
  nonceFamilyId: string;
  txHash: Buffer;
  rawSignedTransaction: Buffer;
  replacementOfId: string | null;
  state: TransactionAttemptState;
  firstBroadcastAt: Date | null;
  lastBroadcastAt: Date | null;
  createdAt: Date;
}

function mapAttemptRow(row: Record<string, unknown>): TransactionAttemptRow {
  return {
    id: row.id as string,
    deploymentId: row.deployment_id as string,
    nonceFamilyId: row.nonce_family_id as string,
    txHash: row.tx_hash as Buffer,
    rawSignedTransaction: row.raw_signed_transaction as Buffer,
    replacementOfId: (row.replacement_of_id as string | null) ?? null,
    state: row.state as TransactionAttemptState,
    firstBroadcastAt: (row.first_broadcast_at as Date | null) ?? null,
    lastBroadcastAt: (row.last_broadcast_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

/** Persists raw signed bytes + hash BEFORE any network send (recoverable if the process crashes next). */
export async function recordSignedAttempt(
  client: pg.PoolClient,
  params: {
    id: string;
    deploymentId: string;
    nonceFamilyId: string;
    txHash: Buffer;
    rawSignedTransaction: Buffer;
    replacementOfId?: string;
  },
): Promise<TransactionAttemptRow> {
  const result = await client.query(
    `INSERT INTO transaction_attempts (id, deployment_id, nonce_family_id, tx_hash, raw_signed_transaction, replacement_of_id, state)
     VALUES ($1,$2,$3,$4,$5,$6,'SIGNED')
     RETURNING *`,
    [
      params.id,
      params.deploymentId,
      params.nonceFamilyId,
      params.txHash,
      params.rawSignedTransaction,
      params.replacementOfId ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('recordSignedAttempt: INSERT ... RETURNING produced no row');
  return mapAttemptRow(row);
}

/**
 * A fee-only replacement is a distinct hash in the SAME nonce family (Prompt 3 item 3). The
 * replaced attempt's own nonce_family_id is the source of truth for that -- looked up here rather
 * than trusted from the caller's params, so two independently-supplied ids can never silently
 * disagree and attach a replacement to the wrong family.
 */
export async function recordFeeReplacement(
  client: pg.PoolClient,
  params: {
    id: string;
    deploymentId: string;
    nonceFamilyId: string;
    txHash: Buffer;
    rawSignedTransaction: Buffer;
    replacementOfId: string;
  },
): Promise<TransactionAttemptRow> {
  const original = await client.query<{ nonce_family_id: string }>(
    'SELECT nonce_family_id FROM transaction_attempts WHERE id = $1',
    [params.replacementOfId],
  );
  const originalRow = original.rows[0];
  if (!originalRow) {
    throw new Error(
      `recordFeeReplacement: no transaction_attempts row with id ${params.replacementOfId}`,
    );
  }
  if (originalRow.nonce_family_id !== params.nonceFamilyId) {
    throw new Error(
      `recordFeeReplacement: replacementOfId ${params.replacementOfId} belongs to nonce family ${originalRow.nonce_family_id}, not the supplied ${params.nonceFamilyId}`,
    );
  }
  return recordSignedAttempt(client, params);
}

/**
 * Locks the row first so the subsequent UPDATE's `WHERE state = $2` is a compare-and-set against
 * a state this call itself just observed inside the same transaction -- a concurrent caller
 * blocks on the row lock rather than racing the check. SIGNED->SUBMITTED is the first broadcast;
 * an already-SUBMITTED row is treated as an idempotent re-stamp (a duplicate broadcast job re-run
 * after a crash), not an error.
 */
export async function markBroadcast(
  client: pg.PoolClient,
  params: { attemptId: string; isFirstBroadcast: boolean },
): Promise<TransactionAttemptRow> {
  const current = await client.query<{ state: TransactionAttemptState }>(
    'SELECT state FROM transaction_attempts WHERE id = $1 FOR UPDATE',
    [params.attemptId],
  );
  const currentRow = current.rows[0];
  if (!currentRow) {
    throw new Error(`markBroadcast: no transaction_attempts row with id ${params.attemptId}`);
  }
  if (currentRow.state !== 'SIGNED' && currentRow.state !== 'SUBMITTED') {
    throw new InvalidTransactionAttemptStateTransitionError(currentRow.state, 'SUBMITTED');
  }

  const result = await client.query(
    `UPDATE transaction_attempts
     SET state = 'SUBMITTED',
         first_broadcast_at = CASE WHEN $3 THEN now() ELSE first_broadcast_at END,
         last_broadcast_at = now()
     WHERE id = $1 AND state = $2
     RETURNING *`,
    [params.attemptId, currentRow.state, params.isFirstBroadcast],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`markBroadcast: concurrent state change for id ${params.attemptId}`);
  }
  return mapAttemptRow(row);
}

/** Identical raw bytes re-sent to the network -- same row, just a fresh last_broadcast_at. */
export async function recordRebroadcast(
  client: pg.PoolClient,
  params: { deploymentId: string; txHash: Buffer },
): Promise<TransactionAttemptRow> {
  const result = await client.query(
    `UPDATE transaction_attempts SET last_broadcast_at = now()
     WHERE deployment_id = $1 AND tx_hash = $2
     RETURNING *`,
    [params.deploymentId, params.txHash],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(
      `recordRebroadcast: no transaction_attempts row for deployment ${params.deploymentId} tx ${params.txHash.toString('hex')}`,
    );
  }
  return mapAttemptRow(row);
}

/**
 * Attempts signed but never confirmed broadcast (worker crashed between `recordSignedAttempt` and
 * its `eth_sendRawTransaction` call -- recovery table row 4/5). Startup recovery (re)broadcasts
 * these directly from `rawSignedTransaction`; it must never re-sign them.
 */
export async function getSignedNotBroadcastAttempts(
  db: Queryable,
  params: { deploymentId: string },
): Promise<TransactionAttemptRow[]> {
  const result = await db.query(
    `SELECT * FROM transaction_attempts WHERE deployment_id = $1 AND state = 'SIGNED' ORDER BY created_at`,
    [params.deploymentId],
  );
  return result.rows.map(mapAttemptRow);
}

export async function getTransactionAttemptByHash(
  db: Queryable,
  params: { deploymentId: string; txHash: Buffer },
): Promise<TransactionAttemptRow | null> {
  const result = await db.query(
    'SELECT * FROM transaction_attempts WHERE deployment_id = $1 AND tx_hash = $2',
    [params.deploymentId, params.txHash],
  );
  const row = result.rows[0];
  return row ? mapAttemptRow(row) : null;
}

/**
 * Marks the canonical winning attempt for a nonce family: updates the attempt's own state,
 * points the nonce family at that hash, and closes the family so it stops appearing in
 * recoverUnsignedFamilies -- all in the caller's transaction alongside whatever else observing
 * that receipt needs to do (indexing.ts's chain_events / payments state update).
 *
 * Guards against the two failure modes a re-delivered or misrouted chain-observer event could
 * otherwise cause: `attemptId` is cross-checked against its OWN nonce_family_id rather than
 * trusting the caller's `nonceFamilyId` to already agree, and the attempt-state update is a
 * compare-and-set against a row lock taken up front, so a same-state re-delivery (the observer
 * polling the same receipt twice) is a verified idempotent no-op rather than a silent overwrite,
 * and a genuinely conflicting concurrent call fails loudly instead of regressing state.
 */
export async function attachCanonicalReceipt(
  client: pg.PoolClient,
  params: {
    attemptId: string;
    nonceFamilyId: string;
    txHash: Buffer;
    state: TransactionAttemptState;
  },
): Promise<TransactionAttemptRow> {
  const current = await client.query<{
    state: TransactionAttemptState;
    nonce_family_id: string;
  }>('SELECT state, nonce_family_id FROM transaction_attempts WHERE id = $1 FOR UPDATE', [
    params.attemptId,
  ]);
  const currentRow = current.rows[0];
  if (!currentRow) {
    throw new Error(
      `attachCanonicalReceipt: no transaction_attempts row with id ${params.attemptId}`,
    );
  }
  if (currentRow.nonce_family_id !== params.nonceFamilyId) {
    throw new Error(
      `attachCanonicalReceipt: attempt ${params.attemptId} belongs to nonce family ${currentRow.nonce_family_id}, not the supplied ${params.nonceFamilyId}`,
    );
  }

  if (currentRow.state === params.state) {
    // Idempotent re-delivery of the same observation. Safe only if the nonce family is already
    // closed against this exact hash -- if not, two different transactions both claim to be
    // canonical for the same family, which is real corruption, not a benign replay.
    const family = await client.query<{ canonical_tx_hash: Buffer | null; closed_at: Date | null }>(
      'SELECT canonical_tx_hash, closed_at FROM nonce_families WHERE id = $1',
      [params.nonceFamilyId],
    );
    const familyRow = family.rows[0];
    if (!familyRow?.closed_at || !familyRow.canonical_tx_hash?.equals(params.txHash)) {
      throw new Error(
        `attachCanonicalReceipt: re-delivered ${params.state} for attempt ${params.attemptId} does not match the already-closed nonce family ${params.nonceFamilyId}`,
      );
    }
    const unchanged = await client.query('SELECT * FROM transaction_attempts WHERE id = $1', [
      params.attemptId,
    ]);
    return mapAttemptRow(unchanged.rows[0]);
  }

  if (!isTransactionAttemptStateTransitionAllowed(currentRow.state, params.state)) {
    throw new InvalidTransactionAttemptStateTransitionError(currentRow.state, params.state);
  }

  const result = await client.query(
    'UPDATE transaction_attempts SET state = $2 WHERE id = $1 AND state = $3 RETURNING *',
    [params.attemptId, params.state, currentRow.state],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`attachCanonicalReceipt: concurrent state change for id ${params.attemptId}`);
  }

  const closed = await client.query(
    'UPDATE nonce_families SET canonical_tx_hash = $2, closed_at = now() WHERE id = $1 AND closed_at IS NULL',
    [params.nonceFamilyId, params.txHash],
  );
  if (closed.rowCount === 0) {
    throw new Error(
      `attachCanonicalReceipt: nonce family ${params.nonceFamilyId} was already closed by a different attempt`,
    );
  }

  return mapAttemptRow(row);
}

/**
 * Marks every OTHER attempt in the same nonce family as `REPLACED` once one attempt's receipt has
 * been attached as canonical -- fee-replacement losers, or (pre-SPEC-fix) a reconciled recovery
 * double-sign. Must be called in the SAME transaction as the `attachCanonicalReceipt` that just
 * closed the family, never standalone, since it does not itself re-verify canonicality.
 *
 * `SIGNED|SUBMITTED|UNKNOWN -> REPLACED` is legal for all three per
 * `TRANSACTION_ATTEMPT_STATE_GRAPH`, and only the transaction holding `attachCanonicalReceipt`'s
 * row lock on the winning attempt ever reaches this call, so a plain bulk `UPDATE ... WHERE state
 * IN (...)` is safe without per-row optimistic-concurrency checks here (Stage 5 recovery table
 * review, finding 2 -- without this, a losing sibling attempt stayed indistinguishable from a
 * still-pending one forever).
 */
export async function markSiblingAttemptsReplaced(
  client: pg.PoolClient,
  params: { nonceFamilyId: string; winningAttemptId: string },
): Promise<TransactionAttemptRow[]> {
  const result = await client.query(
    `UPDATE transaction_attempts
     SET state = 'REPLACED'
     WHERE nonce_family_id = $1 AND id <> $2 AND state IN ('SIGNED','SUBMITTED','UNKNOWN')
     RETURNING *`,
    [params.nonceFamilyId, params.winningAttemptId],
  );
  return result.rows.map(mapAttemptRow);
}
