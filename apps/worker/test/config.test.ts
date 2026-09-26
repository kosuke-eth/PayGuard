import { describe, expect, it } from 'vitest';
import { assertNoOwnerKeyConfigured, loadWorkerConfig } from '../src/config.js';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://payguard:payguard_local_dev@127.0.0.1:5432/payguard_dev',
  PAYGUARD_DEPLOYMENT_ID: 'test-deployment-id',
  RELAYER_PRIVATE_KEY: '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
} satisfies NodeJS.ProcessEnv;

describe('apps/worker config', () => {
  it('fails fast with the missing variable name when RELAYER_PRIVATE_KEY is absent', () => {
    const env = { ...BASE_ENV };
    delete (env as Record<string, string | undefined>).RELAYER_PRIVATE_KEY;
    expect(() => loadWorkerConfig(env)).toThrow(/RELAYER_PRIVATE_KEY/);
  });

  it('rejects a malformed RELAYER_PRIVATE_KEY', () => {
    expect(() => loadWorkerConfig({ ...BASE_ENV, RELAYER_PRIVATE_KEY: '0xnothex' })).toThrow(
      /RELAYER_PRIVATE_KEY must be a 0x-prefixed/,
    );
  });

  it('fails fast when PAYGUARD_DEPLOYMENT_ID is missing', () => {
    const env = { ...BASE_ENV };
    delete (env as Record<string, string | undefined>).PAYGUARD_DEPLOYMENT_ID;
    expect(() => loadWorkerConfig(env)).toThrow(/PAYGUARD_DEPLOYMENT_ID/);
  });

  it('refuses to boot if any forbidden owner-key variable is present', () => {
    for (const name of ['OWNER_PRIVATE_KEY', 'VAULT_OWNER_PRIVATE_KEY', 'OWNER_KEY', 'OWNER_MNEMONIC']) {
      expect(() => assertNoOwnerKeyConfigured({ [name]: '0xdeadbeef' })).toThrow(/owner signing material/);
    }
  });

  it('rejects a non-UUID WORKER_ID (used as outbox.lease_owner)', () => {
    expect(() => loadWorkerConfig({ ...BASE_ENV, WORKER_ID: 'not-a-uuid' })).toThrow(/WORKER_ID/);
  });

  it('rejects a non-integer CHAIN_ID with a named error', () => {
    expect(() => loadWorkerConfig({ ...BASE_ENV, CHAIN_ID: 'abc' })).toThrow(/CHAIN_ID/);
  });

  it('rejects a non-positive WORKER_POLL_INTERVAL_MS with a named error', () => {
    expect(() => loadWorkerConfig({ ...BASE_ENV, WORKER_POLL_INTERVAL_MS: '0' })).toThrow(
      /WORKER_POLL_INTERVAL_MS/,
    );
  });

  it('applies documented local defaults when optional vars are absent', () => {
    const config = loadWorkerConfig(BASE_ENV);
    expect(config.rpcUrl).toBe('http://127.0.0.1:8545');
    expect(config.chainId).toBe(31337n);
    expect(config.leaseDurationSeconds).toBe(60);
    expect(config.pollIntervalMs).toBe(500);
    expect(config.indexerBatchBlocks).toBe(500n);
  });
});
