/**
 * POST /v1/invoices -- merchant signature validity (EOA-only, mirroring the vault's
 * ECDSA.tryRecover), wire-width rejection, and the invoice-identity invariant: one consumed
 * identity is (vault, recipient, invoiceId) -- resubmitting the identical invoice is idempotent,
 * resubmitting the SAME identity with different protected bytes is a 409 conflict, never a second
 * payable obligation (CLAUDE.md invariants; SPEC-016).
 */
import { randomBytes } from 'node:crypto';
import { hashInvoice } from '@payguard/domain';
import { MERCHANT_PRIVATE_KEY } from '@payguard/test-utils';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authHeaders,
  createTestHarness,
  seedOwnerVault,
  seedPolicy,
  seedSession,
  type TestHarness,
} from './helpers/testApp.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
}, 60_000);

afterAll(async () => {
  await harness.stopAnvil();
}, 30_000);

async function seedVaultWithMerchant(): Promise<{
  vaultId: string;
  sessionHeaders: Record<string, string>;
  merchantId: `0x${string}`;
}> {
  const { walletId, vaultId } = await seedOwnerVault(harness);
  const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
  const merchantId = `0x${'a'.repeat(64)}` as `0x${string}`;
  await seedPolicy(harness, {
    vaultId,
    onchainPolicyId: `0x${randomBytes(32).toString('hex')}`,
    config: {
      agent: harness.fixture.agentAccount.address,
      inputToken: harness.fixture.tokenAddress,
      settlementToken: harness.fixture.tokenAddress,
      adapter: '0x0000000000000000000000000000000000000000',
      routeId: `0x${'0'.repeat(64)}`,
      totalOutputBudget: '1000000000',
      epochOutputBudget: '500000000',
      automaticOutputCap: '100000000',
      escalationOutputCap: '200000000',
      totalInputBudget: '1000000000',
      maxInputPerPayment: '50000000',
      validAfter: '0',
      validUntil: '99999999999',
      allowedCategoryBitmap: '1',
      subsidyMode: 'NONE',
    },
    merchants: [
      {
        merchantId,
        recipient: harness.fixture.merchantAccount.address,
        invoiceSigner: harness.fixture.merchantAccount.address,
        category: 0,
      },
    ],
  });
  return { vaultId, sessionHeaders: authHeaders(session), merchantId };
}

function baseInvoice(merchantId: `0x${string}`, overrides: Partial<Record<string, string>> = {}) {
  return {
    invoiceId: `0x${'1'.repeat(64)}`,
    merchantId,
    recipient: harness.fixture.merchantAccount.address,
    settlementToken: harness.fixture.tokenAddress,
    outputAmount: '1000000',
    category: '0',
    validUntil: '99999999999',
    ...overrides,
  };
}

async function signInvoice(
  invoice: ReturnType<typeof baseInvoice>,
  vaultId: string,
  privateKey: `0x${string}`,
): Promise<`0x${string}`> {
  const vaultRow = await harness.pool.query('SELECT * FROM vaults WHERE id = $1', [vaultId]);
  const deploymentRow = await harness.pool.query('SELECT chain_id FROM deployments WHERE id = $1', [
    vaultRow.rows[0].deployment_id,
  ]);
  const chainId = Number(deploymentRow.rows[0].chain_id);
  const digest = hashInvoice(
    { chainId, verifyingContract: harness.fixture.vaultAddress },
    invoice as never,
  );
  const account = privateKeyToAccount(privateKey);
  return account.sign({ hash: digest });
}

describe('POST /v1/invoices', () => {
  it('accepts a validly-signed invoice from a known merchant snapshot', async () => {
    const { vaultId, sessionHeaders, merchantId } = await seedVaultWithMerchant();
    const invoice = baseInvoice(merchantId);
    const merchantSignature = await signInvoice(invoice, vaultId, MERCHANT_PRIVATE_KEY);

    const response = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/invoices',
      headers: sessionHeaders,
      payload: { vaultId, invoice, merchantSignature },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json().data;
    expect(body.signatureValid).toBe(true);
    expect(body.invoiceResourceId).toBeTruthy();
  });

  it('rejects an invoice signed by a key that is not a known merchant snapshot signer', async () => {
    const { vaultId, sessionHeaders, merchantId } = await seedVaultWithMerchant();
    const invoice = baseInvoice(merchantId);
    // Signed by the AGENT key, not the merchant key the vault snapshot names.
    const wrongSignature = await signInvoice(
      invoice,
      vaultId,
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    );

    const response = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/invoices',
      headers: sessionHeaders,
      payload: { vaultId, invoice, merchantSignature: wrongSignature },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INVALID_SIGNATURE');
  });

  it('rejects a category at the wire boundary above 255', async () => {
    const { vaultId, sessionHeaders, merchantId } = await seedVaultWithMerchant();
    const invoice = baseInvoice(merchantId, { category: '256' });
    const merchantSignature = await signInvoice(invoice, vaultId, MERCHANT_PRIVATE_KEY);

    const response = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/invoices',
      headers: sessionHeaders,
      payload: { vaultId, invoice, merchantSignature },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_SCHEMA');
  });

  it('rejects a zero outputAmount', async () => {
    const { vaultId, sessionHeaders, merchantId } = await seedVaultWithMerchant();
    const invoice = baseInvoice(merchantId, { outputAmount: '0' });
    const merchantSignature = await signInvoice(invoice, vaultId, MERCHANT_PRIVATE_KEY);

    const response = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/invoices',
      headers: sessionHeaders,
      payload: { vaultId, invoice, merchantSignature },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_SCHEMA');
  });

  it('resubmitting the IDENTICAL invoice is idempotent (same resource id, 200 not 201)', async () => {
    const { vaultId, sessionHeaders, merchantId } = await seedVaultWithMerchant();
    const invoice = baseInvoice(merchantId, { invoiceId: `0x${'2'.repeat(64)}` });
    const merchantSignature = await signInvoice(invoice, vaultId, MERCHANT_PRIVATE_KEY);

    const first = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/invoices',
      headers: sessionHeaders,
      payload: { vaultId, invoice, merchantSignature },
    });
    expect(first.statusCode).toBe(201);
    const firstId = first.json().data.invoiceResourceId;

    const second = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/invoices',
      headers: sessionHeaders,
      payload: { vaultId, invoice, merchantSignature },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.invoiceResourceId).toBe(firstId);
  });

  it('the SAME identity (vault, recipient, invoiceId) with DIFFERENT protected bytes is a 409 conflict, never a second obligation', async () => {
    const { vaultId, sessionHeaders, merchantId } = await seedVaultWithMerchant();
    const invoiceId = `0x${'3'.repeat(64)}` as `0x${string}`;
    const original = baseInvoice(merchantId, { invoiceId, outputAmount: '1000000' });
    const originalSignature = await signInvoice(original, vaultId, MERCHANT_PRIVATE_KEY);

    const first = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/invoices',
      headers: sessionHeaders,
      payload: { vaultId, invoice: original, merchantSignature: originalSignature },
    });
    expect(first.statusCode).toBe(201);

    // Same identity (vault, recipient, invoiceId), but a different outputAmount -- this must never
    // silently create a second payable obligation.
    const mutated = baseInvoice(merchantId, { invoiceId, outputAmount: '2000000' });
    const mutatedSignature = await signInvoice(mutated, vaultId, MERCHANT_PRIVATE_KEY);
    const conflict = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/invoices',
      headers: sessionHeaders,
      payload: { vaultId, invoice: mutated, merchantSignature: mutatedSignature },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('INVOICE_ID_REUSED');
  });
});
