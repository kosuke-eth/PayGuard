/**
 * Versioned, repeatable SQL migration runner. Explicit SQL only (ARCH 3.2: "Use one PostgreSQL
 * database and the pg driver with explicit SQL") -- no ORM/migration-framework dependency.
 *
 * Each file in the migrations directory is named `NNNN_description.sql` (zero-padded version
 * prefix, sorted lexicographically = sorted numerically). Applied versions are tracked in
 * `schema_migrations`. A migration file is hashed (sha256 of its exact contents); if a version
 * already recorded as applied has a different checksum than the file on disk, the run fails loudly
 * rather than silently re-running or ignoring the drift -- migrations are append-only history, not
 * something to edit after they've run against a real database.
 *
 * A session-level advisory lock serializes concurrent `applyMigrations` invocations against the
 * same database (e.g. two processes starting at once), so a second normal invocation always sees
 * the first one's completed result rather than racing it.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';

export interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

const VERSION_PREFIX = /^(\d+)_/;

export function loadMigrations(migrationsDir: string): MigrationFile[] {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((f) => {
    const match = VERSION_PREFIX.exec(f);
    if (!match?.[1]) {
      throw new Error(`migration filename missing a numeric version prefix (NNNN_name.sql): ${f}`);
    }
    const sql = readFileSync(path.join(migrationsDir, f), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    return { version: match[1], name: f, sql, checksum };
  });
}

const ENSURE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  name text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
`;

// Fixed advisory-lock key for this project's migration runner (arbitrary but stable constant,
// well within the safe-integer/int8 range pg_advisory_lock accepts).
const MIGRATION_LOCK_KEY = 847362951;

export interface ApplyResult {
  applied: string[];
  skipped: string[];
}

export class MigrationChecksumMismatchError extends Error {
  readonly version: string;
  readonly migrationName: string;

  constructor(version: string, migrationName: string) {
    super(
      `migration ${version} (${migrationName}) already applied with a different checksum than the file on disk. ` +
        'Never edit an applied migration -- add a new migration instead.',
    );
    this.name = 'MigrationChecksumMismatchError';
    this.version = version;
    this.migrationName = migrationName;
  }
}

export async function applyMigrations(pool: pg.Pool, migrationsDir: string): Promise<ApplyResult> {
  const migrations = loadMigrations(migrationsDir);
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query(ENSURE_MIGRATIONS_TABLE);
      const existingRows = await client.query<{ version: string; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations',
      );
      const existingByVersion = new Map(existingRows.rows.map((r) => [r.version, r.checksum]));

      for (const m of migrations) {
        const existingChecksum = existingByVersion.get(m.version);
        if (existingChecksum !== undefined) {
          if (existingChecksum !== m.checksum) {
            throw new MigrationChecksumMismatchError(m.version, m.name);
          }
          skipped.push(m.version);
          continue;
        }
        await client.query('BEGIN');
        try {
          await client.query(m.sql);
          await client.query(
            'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
            [m.version, m.name, m.checksum],
          );
          await client.query('COMMIT');
          applied.push(m.version);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
  return { applied, skipped };
}
