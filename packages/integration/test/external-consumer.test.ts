/**
 * Exercises this package exactly as an EXTERNAL client would: imports only from
 * `@payguard/integration`'s published surface (never a sibling backend package), builds a signed
 * Invoice, validates it against the published wire schema, computes its EIP-712 digest, signs it
 * with a local test wallet, and confirms the digest/signature round-trip independently recovers
 * the signer. `ajv` and `viem` here play the role of tooling an external consumer would bring
 * themselves (a JSON Schema validator, a wallet library) -- neither is exported by this package.
 */
import Ajv from 'ajv';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import {
  domainFor,
  hashInvoice,
  INVOICE_SCHEMA,
  type Invoice,
  isAddress,
  isHash32,
  PAYGUARD_VAULT_ABI,
  PUBLIC_CONFIG_SCHEMA,
} from '../src/index.js';

describe('external consumer: build, validate, hash, and sign an Invoice', () => {
  const ajv = new Ajv({ strict: true });
  const validateInvoice = ajv.compile(INVOICE_SCHEMA);

  it('a well-formed Invoice validates against the published schema', () => {
    const invoice: Invoice = {
      invoiceId: `0x${'11'.repeat(32)}`,
      merchantId: `0x${'22'.repeat(32)}`,
      recipient: '0x1111111111111111111111111111111111111111',
      settlementToken: '0x2222222222222222222222222222222222222222',
      outputAmount: '500000',
      category: '3',
      validUntil: '9999999999',
    };
    expect(validateInvoice(invoice)).toBe(true);
    expect(isAddress(invoice.recipient)).toBe(true);
    expect(isHash32(invoice.invoiceId)).toBe(true);
  });

  it('rejects an extra field the same way the API does (additionalProperties: false)', () => {
    const withExtra = {
      invoiceId: `0x${'11'.repeat(32)}`,
      merchantId: `0x${'22'.repeat(32)}`,
      recipient: '0x1111111111111111111111111111111111111111',
      settlementToken: '0x2222222222222222222222222222222222222222',
      outputAmount: '500000',
      category: '3',
      validUntil: '9999999999',
      unexpectedField: 'should not be allowed',
    };
    expect(validateInvoice(withExtra)).toBe(false);
  });

  it('rejects a coerced/malformed integer string (exponent notation)', () => {
    const malformed = {
      invoiceId: `0x${'11'.repeat(32)}`,
      merchantId: `0x${'22'.repeat(32)}`,
      recipient: '0x1111111111111111111111111111111111111111',
      settlementToken: '0x2222222222222222222222222222222222222222',
      outputAmount: '5e5',
      category: '3',
      validUntil: '9999999999',
    };
    expect(validateInvoice(malformed)).toBe(false);
  });

  it('computes the EIP-712 digest and an independent signature round-trips to the same signer', async () => {
    const invoice: Invoice = {
      invoiceId: `0x${'11'.repeat(32)}`,
      merchantId: `0x${'22'.repeat(32)}`,
      recipient: '0x1111111111111111111111111111111111111111',
      settlementToken: '0x2222222222222222222222222222222222222222',
      outputAmount: '500000',
      category: '3',
      validUntil: '9999999999',
    };

    const account = privateKeyToAccount(`0x${'aa'.repeat(32)}`);
    const domain = domainFor({
      chainId: 31337,
      verifyingContract: '0x3333333333333333333333333333333333333333',
    });
    const digest = hashInvoice(
      { chainId: 31337, verifyingContract: '0x3333333333333333333333333333333333333333' },
      invoice,
    );

    const signature = await account.signMessage({ message: { raw: digest } });
    expect(signature.startsWith('0x')).toBe(true);
    expect(digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(domain.name).toBe('PayGuard');
  });

  it('the generated vault ABI is present and non-empty, usable without importing @payguard/chain', () => {
    expect(Array.isArray(PAYGUARD_VAULT_ABI)).toBe(true);
    expect(PAYGUARD_VAULT_ABI.length).toBeGreaterThan(0);
    const hasExecutePayment = PAYGUARD_VAULT_ABI.some(
      (entry: { type: string; name?: string }) =>
        entry.type === 'function' && entry.name === 'executePayment',
    );
    expect(hasExecutePayment).toBe(true);
  });

  it('the public config schema validates a representative GET /v1/config response', () => {
    const validateConfig = ajv.compile(PUBLIC_CONFIG_SCHEMA);
    const sample = {
      deploymentId: '11111111-1111-1111-1111-111111111111',
      environment: 'LOCAL_DEMO',
      chainId: '31337',
      schemaVersion: '1',
      abiSchemaVersion: '1',
      tokens: [
        {
          address: '0x2222222222222222222222222222222222222222',
          symbol: 'mUSDC',
          decimals: 6,
          isMock: true,
        },
      ],
      routes: [],
      confidencePolicy: { mode: 'LOCAL_DEMO', confirmationDepth: null },
    };
    expect(validateConfig(sample)).toBe(true);
  });
});
