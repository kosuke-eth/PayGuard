import { describe, expect, it } from 'vitest';
import { assertNoOwnerKeyConfigured, loadConfig } from '../src/config.js';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://payguard:payguard_local_dev@127.0.0.1:5432/payguard_dev',
  PAYGUARD_DEPLOYMENT_ID: 'test-deployment-id',
} satisfies NodeJS.ProcessEnv;

describe('apps/api config', () => {
  it('fails fast with the missing variable name when a required var is absent', () => {
    const env = { ...BASE_ENV };
    delete (env as Record<string, string | undefined>).DATABASE_URL;
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
  });

  it('fails fast when PAYGUARD_DEPLOYMENT_ID is missing', () => {
    const env = { ...BASE_ENV };
    delete (env as Record<string, string | undefined>).PAYGUARD_DEPLOYMENT_ID;
    expect(() => loadConfig(env)).toThrow(/PAYGUARD_DEPLOYMENT_ID/);
  });

  it('refuses to boot if any forbidden owner-key variable is present', () => {
    for (const name of ['OWNER_PRIVATE_KEY', 'VAULT_OWNER_PRIVATE_KEY', 'OWNER_KEY', 'OWNER_MNEMONIC']) {
      expect(() => assertNoOwnerKeyConfigured({ [name]: '0xdeadbeef' })).toThrow(/owner signing material/);
    }
  });

  it('applies documented local defaults when optional vars are absent', () => {
    const config = loadConfig(BASE_ENV);
    expect(config.port).toBe(3000);
    expect(config.host).toBe('127.0.0.1');
    expect(config.rpcUrl).toBe('http://127.0.0.1:8545');
    expect(config.chainId).toBe(31337n);
    expect(config.environment).toBe('LOCAL_DEMO');
    expect(config.cookie.sameSite).toBe('Strict');
    expect(config.cookie.secure).toBe(true);
  });

  it('rejects a non-integer API_PORT with a named error', () => {
    expect(() => loadConfig({ ...BASE_ENV, API_PORT: 'not-a-number' })).toThrow(/API_PORT/);
  });

  it('rejects a non-integer CHAIN_ID with a named error', () => {
    expect(() => loadConfig({ ...BASE_ENV, CHAIN_ID: '0xabc' })).toThrow(/CHAIN_ID/);
  });

  it('rejects an unrecognized PAYGUARD_ENVIRONMENT value with a named error', () => {
    expect(() => loadConfig({ ...BASE_ENV, PAYGUARD_ENVIRONMENT: 'PRODUCTION' })).toThrow(
      /PAYGUARD_ENVIRONMENT/,
    );
  });

  it('rejects an unrecognized API_COOKIE_SAMESITE value with a named error', () => {
    expect(() => loadConfig({ ...BASE_ENV, API_COOKIE_SAMESITE: 'Loose' })).toThrow(
      /API_COOKIE_SAMESITE/,
    );
  });

  it('requires all three demo keys, as valid hex private keys, once PAYGUARD_DEMO_ENABLED=true', () => {
    expect(() => loadConfig({ ...BASE_ENV, PAYGUARD_DEMO_ENABLED: 'true' })).toThrow(
      /DEMO_MERCHANT_PRIVATE_KEY/,
    );
    expect(() =>
      loadConfig({
        ...BASE_ENV,
        PAYGUARD_DEMO_ENABLED: 'true',
        DEMO_MERCHANT_PRIVATE_KEY: 'not-hex',
        DEMO_AGENT_PRIVATE_KEY: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
        DEMO_UNAUTHORIZED_MERCHANT_PRIVATE_KEY:
          '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
      }),
    ).toThrow(/DEMO_MERCHANT_PRIVATE_KEY must be a 0x-prefixed/);
  });

  it('leaves demo config null when PAYGUARD_DEMO_ENABLED is unset', () => {
    const config = loadConfig(BASE_ENV);
    expect(config.demo).toBeNull();
  });
});
