/**
 * Process-wide dependencies handed to route handlers.
 *
 * Chain access is behind `packages/chain`; SQL is behind an explicit use-case transaction. Neither
 * a raw viem client nor a raw pg client is ever exposed directly to a handler, so the discipline
 * "read SQL (short tx) -> close -> RPC -> one short write tx" stays enforceable in one place.
 */
import { createLocalPublicClient, createVaultReader, type VaultReader } from '@payguard/chain';
import type { Address } from '@payguard/domain';
import type pg from 'pg';
import type { PublicClient } from 'viem';
import type { ApiConfig } from './config.js';

export interface AppContext {
  config: ApiConfig;
  pool: pg.Pool;
  /** Null when the process is configured without chain access (unit tests, degraded operation). */
  publicClient: PublicClient | null;
  vaultReaderFor(vaultAddress: Address): VaultReader | null;
  now(): Date;
}

export interface CreateContextOptions {
  config: ApiConfig;
  pool: pg.Pool;
  /** Injectable so tests can run without a chain, and so a degraded RPC is representable. */
  publicClient?: PublicClient | null;
  now?: () => Date;
}

export function createAppContext(options: CreateContextOptions): AppContext {
  const publicClient =
    options.publicClient !== undefined
      ? options.publicClient
      : createLocalPublicClient({
          rpcUrl: options.config.rpcUrl,
          chainId: Number(options.config.chainId),
        });

  return {
    config: options.config,
    pool: options.pool,
    publicClient,
    vaultReaderFor(vaultAddress: Address): VaultReader | null {
      if (!publicClient) return null;
      return createVaultReader({ publicClient, vaultAddress });
    },
    now: options.now ?? (() => new Date()),
  };
}
