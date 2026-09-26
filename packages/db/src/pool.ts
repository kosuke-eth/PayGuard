/**
 * Thin pg Pool wrapper. Stage 1 scope: prove the driver + a real local PostgreSQL connect,
 * and fix the exact-numeric reading rule (ARCH 3.2 "Read amount columns as amount::text, then
 * parse to bigint when needed" — never let node-postgres's default numeric->JS-number parsing
 * touch a uint256 column, which silently loses precision above 2^53-1).
 *
 * Domain schema/migrations/transactions are Stage 3 scope, not implemented here.
 */
import pg from 'pg';

const { Pool, types: pgTypes } = pg;

// PostgreSQL OID 1700 = numeric. Force string passthrough (not JS number) for every numeric
// column read through any pool created by this module, so callers must explicitly BigInt() it.
pgTypes.setTypeParser(1700, (value: string) => value);

export interface PoolOptions {
  connectionString: string;
}

export function createPool(options: PoolOptions): pg.Pool {
  return new Pool({ connectionString: options.connectionString });
}

/** Stage 1 connectivity proof: a real round trip against a real local PostgreSQL instance. */
export async function checkConnectivity(
  pool: pg.Pool,
): Promise<{ ok: true; serverVersion: string }> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ version: string }>('SELECT version() AS version');
    const row = result.rows[0];
    if (!row) throw new Error('SELECT version() returned no rows');
    return { ok: true, serverVersion: row.version };
  } finally {
    client.release();
  }
}

/** Round-trips a uint256-range numeric value through the driver without precision loss. */
export async function checkUint256RoundTrip(
  pool: pg.Pool,
  value: bigint,
): Promise<{ ok: boolean; roundTripped: bigint }> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ echoed: string }>('SELECT $1::numeric AS echoed', [
      value.toString(10),
    ]);
    const row = result.rows[0];
    if (!row) throw new Error('round-trip query returned no rows');
    const roundTripped = BigInt(row.echoed);
    return { ok: roundTripped === value, roundTripped };
  } finally {
    client.release();
  }
}

/**
 * Explicit transaction boundary: one checked-out client owns BEGIN..COMMIT/ROLLBACK for the
 * whole of `fn`. ARCH 3.2: "A single checked-out connection owns each SQL transaction;
 * pool.query calls cannot be assumed to share a transaction." Every multi-statement repository
 * function in this package takes a client (never a bare pool) for exactly this reason -- the
 * caller decides the transaction boundary, this helper just makes the common case (one
 * transaction per call) explicit and leak-free.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
  }
}

/** Anything with a pg-shaped .query() -- a Pool or a checked-out PoolClient. */
export type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;
