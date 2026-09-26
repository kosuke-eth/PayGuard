import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applyMigrations } from '../../src/migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TEST_DATABASE_URL =
  process.env.DATABASE_TEST_URL ??
  'postgresql://payguard:payguard_local_dev@127.0.0.1:5432/payguard_test';

export const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

let sharedPool: pg.Pool | undefined;

export function getTestPool(): pg.Pool {
  sharedPool ??= new pg.Pool({ connectionString: TEST_DATABASE_URL });
  return sharedPool;
}

export async function ensureMigrated(pool: pg.Pool): Promise<void> {
  await applyMigrations(pool, MIGRATIONS_DIR);
}

const DOMAIN_TABLES = [
  'payment_timeline',
  'outbox',
  'indexer_cursors',
  'chain_events',
  'receipts',
  'chain_blocks',
  'transaction_attempts',
  'nonce_families',
  'signer_state',
  'operations',
  'idempotency_keys',
  'approvals',
  'payment_intents',
  'payments',
  'invoices',
  'signed_artifacts',
  'policy_merchants',
  'policies',
  'policy_draft_revisions',
  'policy_drafts',
  'vaults',
  'sessions',
  'auth_challenges',
  'wallets',
  'deployments',
];

/** Wipes every domain row (not schema_migrations) so a test file starts from a clean slate. */
export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query(`TRUNCATE TABLE ${DOMAIN_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export function uuid(): string {
  return randomUUID();
}

/** A deterministic-looking but test-unique 20-byte address, derived from a short label. */
export function fakeAddress(label: string): Buffer {
  const buf = Buffer.alloc(20, 0);
  Buffer.from(label).copy(buf);
  return buf;
}

export function fakeHash32(label: string): Buffer {
  const buf = Buffer.alloc(32, 0);
  Buffer.from(label).copy(buf);
  return buf;
}
