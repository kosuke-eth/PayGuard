/**
 * SIWE challenges and API sessions (Stage 4).
 *
 * A session here is an API credential ONLY. It is never spending authority: every fund-moving
 * action still requires the relevant EIP-712 signature checked by the vault (CLAUDE.md: "A login
 * session is not spending authority"). Revoking a session does not revoke an on-chain agent.
 *
 * Secrets are stored as sha256 hashes, never in plaintext, so a database read cannot yield a
 * usable bearer token or CSRF token.
 */
import type pg from 'pg';
import type { Queryable } from '../pool.js';

export type SessionKind = 'BROWSER' | 'AGENT';

export interface AuthChallengeRow {
  id: string;
  walletId: string;
  chainId: bigint;
  nonceHash: Buffer;
  expectedMessage: string;
  sessionKind: SessionKind;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

function mapChallengeRow(row: Record<string, unknown>): AuthChallengeRow {
  return {
    id: row.id as string,
    walletId: row.wallet_id as string,
    chainId: BigInt(row.chain_id as string),
    nonceHash: row.nonce_hash as Buffer,
    expectedMessage: row.expected_message as string,
    sessionKind: row.session_kind as SessionKind,
    expiresAt: row.expires_at as Date,
    consumedAt: (row.consumed_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

/**
 * Persists the complete server-generated SIWE message plus the intended `sessionKind` (SPEC-004).
 * Capturing the kind HERE, at challenge creation, is what stops a caller from requesting a
 * BROWSER challenge and then verifying it as an AGENT to obtain a bearer token (or vice versa) --
 * verification reads the kind back from this row rather than from the verify request.
 */
export async function createAuthChallenge(
  client: pg.PoolClient,
  params: {
    id: string;
    walletId: string;
    chainId: bigint;
    nonceHash: Buffer;
    expectedMessage: string;
    sessionKind: SessionKind;
    expiresAt: Date;
  },
): Promise<AuthChallengeRow> {
  const result = await client.query(
    `INSERT INTO auth_challenges (id, wallet_id, chain_id, nonce_hash, expected_message, session_kind, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      params.id,
      params.walletId,
      params.chainId.toString(10),
      params.nonceHash,
      params.expectedMessage,
      params.sessionKind,
      params.expiresAt,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('createAuthChallenge: INSERT ... RETURNING produced no row');
  return mapChallengeRow(row);
}

export async function getAuthChallengeById(
  db: Queryable,
  id: string,
): Promise<AuthChallengeRow | null> {
  const result = await db.query('SELECT * FROM auth_challenges WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapChallengeRow(row) : null;
}

/**
 * Compare-and-set consumption. Returns the row only if THIS call is the one that consumed it;
 * a null result means the challenge was already used (replay) or never existed.
 *
 * API_CONTRACT.md requires challenge consumption and session creation to be atomic, so the caller
 * runs this and `createSession` inside one transaction: two concurrent verifications of the same
 * challenge therefore produce exactly one session, not two independently reusable ones.
 */
export async function consumeAuthChallenge(
  client: pg.PoolClient,
  params: { id: string; now: Date },
): Promise<AuthChallengeRow | null> {
  const result = await client.query(
    `UPDATE auth_challenges
     SET consumed_at = $2
     WHERE id = $1 AND consumed_at IS NULL AND expires_at > $2
     RETURNING *`,
    [params.id, params.now],
  );
  const row = result.rows[0];
  return row ? mapChallengeRow(row) : null;
}

export interface SessionRow {
  id: string;
  walletId: string;
  tokenHash: Buffer;
  csrfTokenHash: Buffer | null;
  sessionKind: SessionKind;
  chainId: bigint;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

function mapSessionRow(row: Record<string, unknown>): SessionRow {
  return {
    id: row.id as string,
    walletId: row.wallet_id as string,
    tokenHash: row.token_hash as Buffer,
    csrfTokenHash: (row.csrf_token_hash as Buffer | null) ?? null,
    sessionKind: row.session_kind as SessionKind,
    chainId: BigInt(row.chain_id as string),
    expiresAt: row.expires_at as Date,
    revokedAt: (row.revoked_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

/**
 * `tokenHash` is required for BOTH kinds: an agent's bearer token and a browser's cookie value are
 * each hashed into it (the column is NOT NULL UNIQUE). `csrfTokenHash` is additionally set for
 * BROWSER sessions, whose mutations must also present a matching CSRF header.
 *
 * `chainId` is the chain from the VERIFIED SIWE message and is checked against every accessed
 * deployment afterwards -- the same contract-wallet address on another chain is not automatically
 * the same authority (ARCH 3.5).
 */
export async function createSession(
  client: pg.PoolClient,
  params: {
    id: string;
    walletId: string;
    tokenHash: Buffer;
    csrfTokenHash: Buffer | null;
    sessionKind: SessionKind;
    chainId: bigint;
    expiresAt: Date;
  },
): Promise<SessionRow> {
  const result = await client.query(
    `INSERT INTO sessions (id, wallet_id, token_hash, csrf_token_hash, session_kind, chain_id, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      params.id,
      params.walletId,
      params.tokenHash,
      params.csrfTokenHash,
      params.sessionKind,
      params.chainId.toString(10),
      params.expiresAt,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('createSession: INSERT ... RETURNING produced no row');
  return mapSessionRow(row);
}

export interface ResolvedSession {
  session: SessionRow;
  walletAddress: Buffer;
}

/**
 * Resolves a presented credential to a live session, rejecting revoked/expired ones in SQL rather
 * than in application code. Joins the wallet so callers get the authenticated address without a
 * second bare-id read.
 */
export async function resolveSessionByTokenHash(
  db: Queryable,
  params: { tokenHash: Buffer; now: Date },
): Promise<ResolvedSession | null> {
  const result = await db.query(
    `SELECT s.*, w.address AS wallet_address
     FROM sessions s
     JOIN wallets w ON w.id = s.wallet_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2`,
    [params.tokenHash, params.now],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    session: mapSessionRow(row),
    walletAddress: row.wallet_address as Buffer,
  };
}

/**
 * Rotates a live BROWSER session's CSRF token (B1, item 6: session recovery after a page reload).
 * The csrf token is stored ONLY as a hash (never recoverable in plaintext once issued), so after a
 * reload discards the in-memory value, the only safe recovery is to mint and store a NEW one --
 * never to weaken the CSRF check by making it optional. Scoped by session id AND still-valid
 * (`revoked_at IS NULL AND expires_at > now`), so a revoked/expired session cannot be silently
 * revived by this call.
 */
export async function rotateSessionCsrfToken(
  db: Queryable,
  params: { sessionId: string; csrfTokenHash: Buffer; now: Date },
): Promise<boolean> {
  const result = await db.query(
    'UPDATE sessions SET csrf_token_hash = $2 WHERE id = $1 AND revoked_at IS NULL AND expires_at > $3',
    [params.sessionId, params.csrfTokenHash, params.now],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Revokes the API session only. Explicitly does not touch any on-chain agent authority. */
export async function revokeSession(
  client: pg.PoolClient,
  params: { id: string; now: Date },
): Promise<boolean> {
  const result = await client.query(
    'UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL',
    [params.id, params.now],
  );
  return (result.rowCount ?? 0) > 0;
}
