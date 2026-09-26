/**
 * Worker process entrypoint: loads config, runs startup recovery (recovery table rows 3-5) BEFORE
 * claiming any outbox work, then runs three independent bounded loops -- outbox claim/dispatch,
 * chain indexing, and heartbeat -- until SIGINT/SIGTERM, at which point it stops claiming new work
 * and exits without losing anything already committed (shutdown never races an in-flight DB
 * transaction: each loop tick either fully commits or the next tick retries from persisted state).
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLocalPublicClient } from '@payguard/chain';
import { createPool } from '@payguard/db';
import type { Address } from '@payguard/domain';
import type pg from 'pg';
import { loadWorkerConfig } from './config.js';
import { removeHeartbeatOnShutdown, startHeartbeatLoop } from './heartbeat.js';
import { runIndexerTick } from './indexer.js';
import { runOutboxTick } from './outboxLoop.js';
import { runStartupRecovery } from './recovery.js';
import { createSubmitDeps } from './submitPayment.js';

function loadRepoDotenv(): void {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

export async function main(): Promise<void> {
  loadRepoDotenv();
  const config = loadWorkerConfig();
  const pool = createPool({ connectionString: config.databaseUrl });
  const publicClient = createLocalPublicClient({
    rpcUrl: config.rpcUrl,
    chainId: Number(config.chainId),
  });
  const submitDeps = createSubmitDeps({ pool, publicClient, config });

  console.log(`payguard worker ${config.workerId} starting for deployment ${config.deploymentId}`);

  const recovery = await runStartupRecovery({
    pool,
    publicClient,
    signer: submitDeps.signer,
    deploymentId: config.deploymentId,
  });
  console.log(
    `startup recovery: ${recovery.signedRecoveredCount} family(ies) signed, ${recovery.rebroadcastCount} attempt(s) rebroadcast`,
  );

  const heartbeat = startHeartbeatLoop(pool, {
    workerId: config.workerId,
    deploymentId: config.deploymentId,
    intervalMs: config.heartbeatIntervalMs,
  });

  let stopping = false;
  const outboxLoop = (async () => {
    while (!stopping) {
      const claimed = await runOutboxTick(
        { pool, submitDeps, leaseDurationSeconds: config.leaseDurationSeconds },
        config.workerId,
      ).catch((error) => {
        console.error(
          `outbox tick failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 0;
      });
      if (claimed === 0) {
        await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
      }
    }
  })();

  const vaultAddresses = await resolveVaultAddresses(pool, config.deploymentId);
  const indexerLoop = (async () => {
    while (!stopping) {
      for (const vaultAddress of vaultAddresses) {
        await runIndexerTick({
          pool,
          publicClient,
          deploymentId: config.deploymentId,
          vaultAddress,
          startBlock: 0n,
          batchBlocks: config.indexerBatchBlocks,
        }).catch((error) => {
          console.error(
            `indexer tick failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    }
  })();

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('worker shutting down: no new work will be claimed');
    await Promise.all([outboxLoop, indexerLoop]);
    heartbeat.stop();
    await removeHeartbeatOnShutdown(pool, config.workerId);
    await pool.end();
    console.log('worker shutdown complete');
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

async function resolveVaultAddresses(pool: pg.Pool, deploymentId: string): Promise<Address[]> {
  const result = await pool.query('SELECT address FROM vaults WHERE deployment_id = $1', [
    deploymentId,
  ]);
  return result.rows.map(
    (row: { address: Buffer }) => `0x${row.address.toString('hex')}` as Address,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
