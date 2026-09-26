/**
 * Payment intents against a REAL on-chain policy: ALLOW/ESCALATE/BLOCK/UNKNOWN decisions read
 * from the real deployed vault's own `evaluate()`, read-only exception-approval generation,
 * mutated owner approvals, and the duplicate-intent identity invariant.
 */

import { PAYGUARD_VAULT_ABI, prepareCreatePolicy } from '@payguard/chain';
import {
  approvalNonceFromIntentHash,
  hashApproval,
  hashIntent,
  hashInvoice,
} from '@payguard/domain';
import { MERCHANT_PRIVATE_KEY } from '@payguard/test-utils';
import { decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createAppContext } from '../src/context.js';
import {
  authHeaders,
  createTestHarness,
  seedOwnerVault,
  seedPolicy,
  seedSession,
  seedWallet,
  type TestHarness,
} from './helpers/testApp.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
}, 60_000);

afterAll(async () => {
  await harness.stopAnvil();
}, 30_000);

function directRouteConfig(overrides: Partial<Record<string, string>> = {}) {
  return {
    agent: harness.fixture.agentAccount.address,
    inputToken: harness.fixture.tokenAddress,
    settlementToken: harness.fixture.tokenAddress,
    adapter: '0x0000000000000000000000000000000000000000' as const,
    routeId: `0x${'0'.repeat(64)}` as const,
    totalOutputBudget: '10000000000',
    epochOutputBudget: '10000000000',
    automaticOutputCap: '10000000000',
    escalationOutputCap: '10000000000',
    totalInputBudget: '10000000000',
    maxInputPerPayment: '10000000000',
    validAfter: '0',
    validUntil: '99999999999',
    allowedCategoryBitmap: '1',
    subsidyMode: 'NONE' as const,
    ...overrides,
  };
}

/** Real on-chain createPolicy, executed through the exact same calldata the API would prepare. */
async function deployRealPolicy(
  vaultId: string,
  config: ReturnType<typeof directRouteConfig>,
  merchants: Array<{
    merchantId: `0x${string}`;
    recipient: `0x${string}`;
    invoiceSigner: `0x${string}`;
    category: number;
  }>,
): Promise<`0x${string}`> {
  const deploymentRow = await harness.pool.query(
    'SELECT chain_id FROM deployments d JOIN vaults v ON v.deployment_id = d.id WHERE v.id = $1',
    [vaultId],
  );
  const chainId = deploymentRow.rows[0].chain_id.toString();

  const prepared = prepareCreatePolicy(
    {
      chainId,
      ownerAddress: harness.fixture.ownerAccount.address,
      vaultAddress: harness.fixture.vaultAddress,
    },
    // biome-ignore lint/suspicious/noExplicitAny: test fixture shape matches PolicyConfig exactly
    config as any,
    merchants.map((m) => ({ ...m, category: m.category.toString(10) })) as never,
  );
  const hash = await harness.fixture.ownerWalletClient.sendTransaction({
    to: prepared.transaction.to as `0x${string}`,
    data: prepared.transaction.data as `0x${string}`,
    value: 0n,
    chain: null,
    account: harness.fixture.ownerAccount,
  });
  const receipt = await harness.fixture.publicClient.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe('success');

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: PAYGUARD_VAULT_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'PolicyCreated') {
        return (decoded.args as { policyId: `0x${string}` }).policyId;
      }
    } catch {
      // not this event
    }
  }
  throw new Error('PolicyCreated event not found in receipt logs');
}

/** Sets up a vault + real on-chain policy + matching seeded DB row + a merchant permission. */
async function setupPolicy(configOverrides: Partial<Record<string, string>> = {}) {
  const { walletId, vaultId } = await seedOwnerVault(harness);
  const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
  const config = directRouteConfig(configOverrides);
  const merchantId = `0x${'c'.repeat(64)}` as `0x${string}`;
  const merchants = [
    {
      merchantId,
      recipient: harness.fixture.merchantAccount.address,
      invoiceSigner: harness.fixture.merchantAccount.address,
      category: 0,
    },
  ];

  const onchainPolicyId = await deployRealPolicy(vaultId, config, merchants);
  const { policyId } = await seedPolicy(harness, {
    vaultId,
    onchainPolicyId,
    // biome-ignore lint/suspicious/noExplicitAny: fixture shape matches seedPolicy's config param
    config: config as any,
    merchants,
  });

  const agentWalletId = await seedWallet(harness, harness.fixture.agentAccount.address);
  const agentSession = await seedSession(harness, {
    walletId: agentWalletId,
    sessionKind: 'AGENT',
  });

  return { vaultId, session, agentSession, config, merchantId, onchainPolicyId, policyId };
}

async function depositFunds(
  vaultId: string,
  session: { token: string; csrfToken: string | null },
  amount: bigint,
) {
  await (await import('@payguard/test-utils')).mintTokens(
    harness.fixture,
    harness.fixture.ownerAccount.address,
    amount,
  );
  const prep = await harness.built.app.inject({
    method: 'POST',
    url: `/v1/vaults/${vaultId}/transactions`,
    headers: {
      ...authHeaders(session),
      'idempotency-key': `deposit-${amount}-${Date.now()}-${Math.random()}`,
    },
    payload: {
      action: 'DEPOSIT',
      token: harness.fixture.tokenAddress,
      amountAtomic: amount.toString(10),
    },
  });
  const body = prep.json().data;
  for (const tx of body.transactions) {
    const hash = await harness.fixture.ownerWalletClient.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value),
      chain: null,
      account: harness.fixture.ownerAccount,
    });
    await harness.fixture.publicClient.waitForTransactionReceipt({ hash });
  }
}

async function submitInvoice(
  vaultId: string,
  session: { token: string; csrfToken: string | null },
  merchantId: `0x${string}`,
  overrides: Partial<Record<string, string>> = {},
) {
  const invoice = {
    invoiceId:
      overrides.invoiceId ??
      (`0x${Math.random().toString(16).slice(2).padEnd(64, '0')}` as `0x${string}`),
    merchantId,
    recipient: harness.fixture.merchantAccount.address,
    settlementToken: harness.fixture.tokenAddress,
    outputAmount: overrides.outputAmount ?? '1000000',
    category: overrides.category ?? '0',
    validUntil: overrides.validUntil ?? '99999999999',
  };
  const vaultRow = await harness.pool.query(
    'SELECT chain_id FROM deployments d JOIN vaults v ON v.deployment_id = d.id WHERE v.id = $1',
    [vaultId],
  );
  const digest = hashInvoice(
    { chainId: Number(vaultRow.rows[0].chain_id), verifyingContract: harness.fixture.vaultAddress },
    invoice as never,
  );
  const merchantSignature = await privateKeyToAccount(MERCHANT_PRIVATE_KEY).sign({ hash: digest });
  const response = await harness.built.app.inject({
    method: 'POST',
    url: '/v1/invoices',
    headers: authHeaders(session),
    payload: { vaultId, invoice, merchantSignature },
  });
  expect([200, 201]).toContain(response.statusCode);
  return {
    invoice,
    invoiceHash: digest,
    invoiceResourceId: response.json().data.invoiceResourceId,
  };
}

async function submitIntent(
  vaultId: string,
  session: { token: string; csrfToken: string | null },
  invoiceResourceId: string,
  policyId: string,
  onchainPolicyId: `0x${string}`,
  invoiceHash: `0x${string}`,
  overrides: Partial<Record<string, string>> = {},
) {
  const intent = {
    policyId: onchainPolicyId,
    invoiceHash,
    routeId: `0x${'0'.repeat(64)}` as const,
    maxInputAmount: overrides.maxInputAmount ?? '1000000',
    nonce: overrides.nonce ?? Math.floor(Math.random() * 1e9).toString(10),
    validUntil: overrides.validUntil ?? '99999999999',
    subsidyMode: 'NONE' as const,
    maxSubsidyAmount: '0',
  };
  const vaultRow = await harness.pool.query(
    'SELECT chain_id FROM deployments d JOIN vaults v ON v.deployment_id = d.id WHERE v.id = $1',
    [vaultId],
  );
  const digest = hashIntent(
    { chainId: Number(vaultRow.rows[0].chain_id), verifyingContract: harness.fixture.vaultAddress },
    intent as never,
  );
  const agentSignature = await privateKeyToAccount(
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  ).sign({ hash: digest });
  const response = await harness.built.app.inject({
    method: 'POST',
    url: '/v1/payment-intents',
    headers: { ...authHeaders(session), 'idempotency-key': `intent-${intent.nonce}` },
    payload: { invoiceResourceId, policyResourceId: policyId, intent, agentSignature },
  });
  return { response, intent, intentDigest: digest };
}

describe('POST /v1/payment-intents -- decisions from the real vault', () => {
  it('ALLOW: a well-funded direct-route payment within all caps', async () => {
    const { vaultId, session, agentSession, merchantId, policyId, onchainPolicyId } =
      await setupPolicy();
    await depositFunds(vaultId, session, 5_000_000n);
    const { invoiceResourceId, invoiceHash } = await submitInvoice(vaultId, session, merchantId, {
      outputAmount: '1000000',
    });
    const { response } = await submitIntent(
      vaultId,
      agentSession,
      invoiceResourceId,
      policyId,
      onchainPolicyId,
      invoiceHash,
      { maxInputAmount: '1000000' },
    );
    expect(response.statusCode).toBe(201);
    expect(response.json().data.evaluation.decision).toBe('ALLOW');
  }, 20_000);

  it('BLOCK: maxInputAmount above the policy maxInputPerPayment', async () => {
    const { vaultId, session, agentSession, merchantId, policyId, onchainPolicyId } =
      await setupPolicy({
        maxInputPerPayment: '100',
      });
    await depositFunds(vaultId, session, 5_000_000n);
    const { invoiceResourceId, invoiceHash } = await submitInvoice(vaultId, session, merchantId, {
      outputAmount: '1000000',
    });
    const { response } = await submitIntent(
      vaultId,
      agentSession,
      invoiceResourceId,
      policyId,
      onchainPolicyId,
      invoiceHash,
      { maxInputAmount: '1000000' },
    );
    expect(response.statusCode).toBe(201);
    expect(response.json().data.evaluation.decision).toBe('BLOCK');
    expect(response.json().data.evaluation.reasonCode).toBe('MAX_INPUT_LIMIT');
  }, 20_000);

  it('UNKNOWN when no chain client is available -- never fabricated as BLOCK', async () => {
    const { vaultId, session, agentSession, merchantId, policyId, onchainPolicyId } =
      await setupPolicy();
    const { invoiceResourceId, invoiceHash } = await submitInvoice(vaultId, session, merchantId);

    // A second app instance sharing the SAME real Postgres pool but with publicClient explicitly
    // null -- representing a real "chain infra unavailable" process, not a stubbed decision.
    const config = loadConfig({
      DATABASE_URL: 'unused-direct-pool',
      PAYGUARD_DEPLOYMENT_ID: harness.deploymentId,
      CHAIN_ID: '31337',
      RPC_URL: harness.fixture.rpcUrl,
      API_SIWE_DOMAIN: '127.0.0.1:3999',
      API_SIWE_URI: 'http://127.0.0.1:3999',
      API_ALLOWED_ORIGINS: 'http://127.0.0.1:3999',
      RELAYER_ADDRESS: harness.fixture.ownerAccount.address,
    });
    const noChainContext = createAppContext({ config, pool: harness.pool, publicClient: null });
    const noChainApp = buildApp(noChainContext);

    const intent = {
      policyId: onchainPolicyId,
      invoiceHash,
      routeId: `0x${'0'.repeat(64)}`,
      maxInputAmount: '1000000',
      nonce: Math.floor(Math.random() * 1e9).toString(10),
      validUntil: '99999999999',
      subsidyMode: 'NONE',
      maxSubsidyAmount: '0',
    };
    const vaultRow = await harness.pool.query(
      'SELECT chain_id FROM deployments d JOIN vaults v ON v.deployment_id = d.id WHERE v.id = $1',
      [vaultId],
    );
    const digest = hashIntent(
      {
        chainId: Number(vaultRow.rows[0].chain_id),
        verifyingContract: harness.fixture.vaultAddress,
      },
      intent as never,
    );
    const agentSignature = await privateKeyToAccount(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    ).sign({ hash: digest });

    const noChainResponse = await noChainApp.app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: {
        ...authHeaders(agentSession),
        'idempotency-key': `intent-unknown-${intent.nonce}`,
      },
      payload: { invoiceResourceId, policyResourceId: policyId, intent, agentSignature },
    });
    expect(noChainResponse.statusCode).toBe(201);
    expect(noChainResponse.json().data.evaluation.decision).toBe('UNKNOWN');
    expect(noChainResponse.json().data.evaluation.reasonCode).toBe('CHAIN_STATE_UNKNOWN');
    await noChainApp.app.close();
  }, 20_000);

  it('duplicate intent: resubmitting the IDENTICAL signed intent is idempotent, not a second version or a 500', async () => {
    const { vaultId, session, agentSession, merchantId, policyId, onchainPolicyId } =
      await setupPolicy();
    await depositFunds(vaultId, session, 5_000_000n);
    const { invoiceResourceId, invoiceHash } = await submitInvoice(vaultId, session, merchantId);

    const fixedNonce = '424242';
    const first = await submitIntent(
      vaultId,
      agentSession,
      invoiceResourceId,
      policyId,
      onchainPolicyId,
      invoiceHash,
      { nonce: fixedNonce, maxInputAmount: '1000000' },
    );
    expect(first.response.statusCode).toBe(201);
    const firstBody = first.response.json().data;

    const second = await submitIntent(
      vaultId,
      agentSession,
      invoiceResourceId,
      policyId,
      onchainPolicyId,
      invoiceHash,
      { nonce: fixedNonce, maxInputAmount: '1000000' },
    );
    expect(second.response.statusCode).toBe(200);
    const secondBody = second.response.json().data;
    expect(secondBody.intentId).toBe(firstBody.intentId);
    expect(secondBody.intentVersion).toBe(firstBody.intentVersion);

    const versions = await harness.pool.query(
      'SELECT count(*)::int AS n FROM payment_intents WHERE payment_id = $1',
      [
        (
          await harness.pool.query('SELECT payment_id FROM payment_intents WHERE id = $1', [
            firstBody.intentId,
          ])
        ).rows[0].payment_id,
      ],
    );
    expect(versions.rows[0].n).toBe(1);
  }, 20_000);
});

describe('ESCALATE: owner-approval flow', () => {
  async function setupEscalation() {
    const { vaultId, session, agentSession, merchantId, policyId, onchainPolicyId } =
      await setupPolicy({
        automaticOutputCap: '100',
        escalationOutputCap: '10000000000',
      });
    await depositFunds(vaultId, session, 5_000_000n);
    const { invoiceResourceId, invoiceHash } = await submitInvoice(vaultId, session, merchantId, {
      outputAmount: '1000000',
    });
    const { response } = await submitIntent(
      vaultId,
      agentSession,
      invoiceResourceId,
      policyId,
      onchainPolicyId,
      invoiceHash,
      { maxInputAmount: '1000000' },
    );
    expect(response.statusCode).toBe(201);
    const body = response.json().data;
    expect(body.evaluation.decision).toBe('ESCALATE');
    return { vaultId, session, intentId: body.intentId };
  }

  it('GET approval-typed-data is read-only: repeated reads return the same deterministic nonce', async () => {
    const { session, intentId } = await setupEscalation();
    const first = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/payment-intents/${intentId}/approval-typed-data`,
      headers: authHeaders(session),
    });
    expect(first.statusCode).toBe(200);
    const second = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/payment-intents/${intentId}/approval-typed-data`,
      headers: authHeaders(session),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.typedData.message.nonce).toBe(
      first.json().data.typedData.message.nonce,
    );
    expect(second.json().data.review.override).toBe('AUTOMATIC_OUTPUT_CAP_ONLY');
  }, 20_000);

  it('a validly-signed owner approval is accepted and a mutated one is rejected', async () => {
    const { session, intentId } = await setupEscalation();
    const typedDataResponse = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/payment-intents/${intentId}/approval-typed-data`,
      headers: authHeaders(session),
    });
    const { typedData } = typedDataResponse.json().data;
    const approval = typedData.message;

    const ownerAccount = privateKeyToAccount(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    );
    const digest = hashApproval(
      { chainId: typedData.domain.chainId, verifyingContract: typedData.domain.verifyingContract },
      approval as never,
    );
    const validSignature = await ownerAccount.sign({ hash: digest });

    // Mutated: tamper one byte of the valid signature before submitting.
    const tampered = `0x${'0'.repeat(2)}${validSignature.slice(4)}` as `0x${string}`;
    const mutatedResponse = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/approvals`,
      headers: authHeaders(session),
      payload: { approval, ownerSignature: tampered },
    });
    expect(mutatedResponse.statusCode).toBe(422);
    expect(mutatedResponse.json().error.code).toBe('INVALID_APPROVAL');

    const validResponse = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/approvals`,
      headers: authHeaders(session),
      payload: { approval, ownerSignature: validSignature },
    });
    expect(validResponse.statusCode).toBe(201);
    expect(validResponse.json().data.status).toBe('SIGNED');
    expect(validResponse.json().data.onChainApprovalTransactionExists).toBe(false);

    // Re-simulating now picks up the stored approval and should no longer be capped by
    // automaticOutputCap alone.
    const simulate = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/simulate`,
      headers: authHeaders(session),
      payload: {},
    });
    expect(simulate.statusCode).toBe(200);
    expect(simulate.json().data.evaluation.decision).toBe('ALLOW');
  }, 20_000);

  it('a mutated approval intentHash (not naming this intent) is rejected before any signature check matters', async () => {
    const { session, intentId } = await setupEscalation();
    const typedDataResponse = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/payment-intents/${intentId}/approval-typed-data`,
      headers: authHeaders(session),
    });
    const { typedData } = typedDataResponse.json().data;
    const mutatedApproval = { ...typedData.message, intentHash: `0x${'9'.repeat(64)}` };

    const ownerAccount = privateKeyToAccount(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    );
    const digest = hashApproval(
      { chainId: typedData.domain.chainId, verifyingContract: typedData.domain.verifyingContract },
      mutatedApproval as never,
    );
    const signature = await ownerAccount.sign({ hash: digest });

    const response = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/approvals`,
      headers: authHeaders(session),
      payload: { approval: mutatedApproval, ownerSignature: signature },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INVALID_APPROVAL');
  }, 20_000);
});
