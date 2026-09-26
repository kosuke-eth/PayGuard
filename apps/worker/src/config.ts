/**
 * Worker process configuration.
 *
 * Mirror image of `apps/api/src/config.ts`'s owner-key prohibition: this process MUST hold the
 * relayer's private key (CLAUDE.md: "A relayer signs/pays for its own outer transaction") and MUST
 * NOT hold an owner key -- `assertNoOwnerKeyConfigured` is the same hard startup check, reused
 * here rather than re-implemented, so the two processes can never drift on what counts as a
 * forbidden variable.
 */
import { randomUUID } from 'node:crypto';
import type { Hex } from 'viem';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WorkerConfig {
  databaseUrl: string;
  rpcUrl: string;
  chainId: bigint;
  /** SPEC-018-equivalent for the worker: the single deployment this process services. */
  deploymentId: string;
  relayerPrivateKey: Hex;
  /** Process-unique identity for outbox lease ownership and worker_heartbeat rows. */
  workerId: string;
  /** How long a claimed outbox job is held before another worker may reclaim it on timeout. */
  leaseDurationSeconds: number;
  /** Idle delay between outbox-claim poll ticks when nothing was claimed. */
  pollIntervalMs: number;
  /** Idle delay between heartbeat writes. */
  heartbeatIntervalMs: number;
  /** Bounded receipt-wait: how many poll attempts a single job invocation makes before requeuing. */
  receiptPollAttempts: number;
  receiptPollIntervalMs: number;
  /** Bounded block range per eth_getLogs call during indexing. */
  indexerBatchBlocks: bigint;
}

const FORBIDDEN_KEY_VARS = [
  'OWNER_PRIVATE_KEY',
  'VAULT_OWNER_PRIVATE_KEY',
  'OWNER_KEY',
  'OWNER_MNEMONIC',
];

export function assertNoOwnerKeyConfigured(env: NodeJS.ProcessEnv = process.env): void {
  const present = FORBIDDEN_KEY_VARS.filter((name) => {
    const value = env[name];
    return typeof value === 'string' && value.length > 0;
  });
  if (present.length > 0) {
    throw new Error(
      `refusing to start: owner signing material must never be configured in the worker process (found: ${present.join(', ')})`,
    );
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing required environment variable ${name}`);
  }
  return value;
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  assertNoOwnerKeyConfigured(env);
  const relayerPrivateKey = required(env, 'RELAYER_PRIVATE_KEY') as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(relayerPrivateKey)) {
    throw new Error('RELAYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex private key');
  }

  // outbox.lease_owner is a `uuid` column (migration 0001) -- workerId doubles as the lease
  // owner identity, so it must actually BE a UUID, not merely process-unique. A non-UUID default
  // here would pass every unit check and then fail the worker's very first claimDueJobs call in
  // real operation.
  const workerId = env.WORKER_ID ?? randomUUID();
  if (!UUID_PATTERN.test(workerId)) {
    throw new Error(`WORKER_ID must be a valid UUID (used as outbox.lease_owner): got ${workerId}`);
  }

  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    rpcUrl: env.RPC_URL ?? 'http://127.0.0.1:8545',
    chainId: BigInt(env.CHAIN_ID ?? '31337'),
    deploymentId: required(env, 'PAYGUARD_DEPLOYMENT_ID'),
    relayerPrivateKey,
    workerId,
    leaseDurationSeconds: Number.parseInt(env.WORKER_LEASE_SECONDS ?? '60', 10),
    pollIntervalMs: Number.parseInt(env.WORKER_POLL_INTERVAL_MS ?? '500', 10),
    heartbeatIntervalMs: Number.parseInt(env.WORKER_HEARTBEAT_INTERVAL_MS ?? '5000', 10),
    receiptPollAttempts: Number.parseInt(env.WORKER_RECEIPT_POLL_ATTEMPTS ?? '10', 10),
    receiptPollIntervalMs: Number.parseInt(env.WORKER_RECEIPT_POLL_INTERVAL_MS ?? '250', 10),
    indexerBatchBlocks: BigInt(env.WORKER_INDEXER_BATCH_BLOCKS ?? '500'),
  };
}
