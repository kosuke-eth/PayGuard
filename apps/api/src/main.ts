/**
 * Process entrypoint: loads config, builds a real pg Pool and viem client, wires the app, and
 * listens. `assertNoOwnerKeyConfigured` runs inside `loadConfig` -- a misconfigured owner key
 * fails startup rather than being silently possible.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '@payguard/db';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createAppContext } from './context.js';

function loadRepoDotenv(): void {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

async function main(): Promise<void> {
  loadRepoDotenv();
  const config = loadConfig();
  const pool = createPool({ connectionString: config.databaseUrl });
  const context = createAppContext({ config, pool });
  const { app } = buildApp(context);

  await app.listen({ port: config.port, host: config.host });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
