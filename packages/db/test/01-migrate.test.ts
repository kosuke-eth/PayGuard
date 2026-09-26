/**
 * Prove clean migration on an empty disposable database, and that a second normal invocation
 * recognizes applied versions rather than dropping tables or re-running them (Prompt 3 item 1
 * and "REQUIRED REAL-DATABASE TESTS": "Prove clean migration and migration reentry").
 *
 * Self-contained: resets the schema to truly empty at the start of this file, independent of
 * whatever other test files in this package have already done (fileParallelism:false in
 * vitest.config.ts means no other file's queries run concurrently with this reset).
 */

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, MigrationChecksumMismatchError } from '../src/migrate.js';
import { MIGRATIONS_DIR, TEST_DATABASE_URL } from './helpers/testDb.js';

const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
});

afterAll(async () => {
  await pool.end();
});

describe('migration runner against a real empty PostgreSQL database', () => {
  it('applies every migration cleanly from empty', async () => {
    const result = await applyMigrations(pool, MIGRATIONS_DIR);
    expect(result.applied).toEqual(['0001', '0002', '0003', '0004', '0005']);
    expect(result.skipped).toEqual([]);

    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
    );
    const names = tables.rows.map((r: { table_name: string }) => r.table_name);
    expect(names).toContain('payments');
    expect(names).toContain('schema_migrations');
    expect(names).toContain('outbox');
    expect(names).toContain('worker_heartbeat');
  });

  it('a second normal invocation recognizes applied versions and changes nothing', async () => {
    const before = await pool.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
    );
    const result = await applyMigrations(pool, MIGRATIONS_DIR);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(['0001', '0002', '0003', '0004', '0005']);
    const after = await pool.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('rejects a migration file edited after it was already applied', async () => {
    // Simulate drift: record a fake checksum for an already-applied version.
    await pool.query("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '0002'");
    await expect(applyMigrations(pool, MIGRATIONS_DIR)).rejects.toBeInstanceOf(
      MigrationChecksumMismatchError,
    );
    // Restore, so later test files in this run see a consistent migration table.
    const { loadMigrations } = await import('../src/migrate.js');
    const real = loadMigrations(MIGRATIONS_DIR).find((m) => m.version === '0002');
    if (!real) throw new Error('0002 migration not found while restoring checksum');
    await pool.query('UPDATE schema_migrations SET checksum = $1 WHERE version = $2', [
      real.checksum,
      '0002',
    ]);
  });
});
