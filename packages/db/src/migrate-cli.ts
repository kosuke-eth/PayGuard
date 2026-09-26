#!/usr/bin/env node
/**
 * Standalone migration CLI: `DATABASE_URL=... pnpm migrate` applies packages/db/migrations
 * against a real PostgreSQL database. Used by verify-stage 03 and by future stages' own
 * bootstrap/deploy scripts -- the same runner the test suite uses internally, callable directly.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations } from './migrate.js';
import { createPool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoEnvPath = path.resolve(__dirname, '../../../.env');
if (existsSync(repoEnvPath)) process.loadEnvFile(repoEnvPath);
const migrationsDir = path.resolve(__dirname, '../migrations');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = createPool({ connectionString });
try {
  const result = await applyMigrations(pool, migrationsDir);
  console.log(`applied: ${result.applied.length > 0 ? result.applied.join(', ') : '(none)'}`);
  console.log(`skipped: ${result.skipped.length > 0 ? result.skipped.join(', ') : '(none)'}`);
} finally {
  await pool.end();
}
