/**
 * Real local PostgreSQL integration test — not a mock. Requires the Stage 1 local dev database
 * to be running and reachable at DATABASE_URL (see ./scripts/payguard db:start, .env.example).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { checkConnectivity, checkUint256RoundTrip, createPool } from '../src/pool.js';

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://payguard:payguard_local_dev@127.0.0.1:5432/payguard_dev';

const pool = createPool({ connectionString });

afterAll(async () => {
  await pool.end();
});

describe('real local PostgreSQL 17 connectivity', () => {
  it('connects and reports a PostgreSQL 17.x server version', async () => {
    const result = await checkConnectivity(pool);
    expect(result.ok).toBe(true);
    expect(result.serverVersion).toMatch(/PostgreSQL 17\./);
  });

  it('round-trips a value above Number.MAX_SAFE_INTEGER without precision loss', async () => {
    const bigValue = 123456789012345678901234567890123456789n;
    const result = await checkUint256RoundTrip(pool, bigValue);
    expect(result.roundTripped).toBe(bigValue);
    expect(result.ok).toBe(true);
  });

  it('round-trips the actual uint256 max without precision loss', async () => {
    const uint256Max =
      115792089237316195423570985008687907853269984665640564039457584007913129639935n;
    const result = await checkUint256RoundTrip(pool, uint256Max);
    expect(result.ok).toBe(true);
  });
});
