/**
 * Durable queued submission (POST /v1/payment-intents/:id/submit) and the payment read contract:
 * queuing is idempotent on INTENT IDENTITY regardless of which principal (owner or bound agent)
 * submits, the response is honest that nothing has executed yet, and payment reads are gated by
 * the per-payment owner/agent/merchant role -- never a vault-wide grant.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { PAYGUARD_VAULT_ABI, prepareCreatePolicy } from '@payguard/chain';
import {
  attachCanonicalReceipt,
  getPaymentById,
  markBroadcast,
  recordSignedAttempt,
  reserveNonceFamily,
  updatePaymentState,
  withTransaction,
} from '@payguard/db';
import { hashIntent, hashInvoice } from '@payguard/domain';
import { MERCHANT_PRIVATE_KEY } from '@payguard/test-utils';
import { decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addressToBuffer } from '../src/auth.js';
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

function directRouteConfig() {
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
  };
}

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
  throw new Error('PolicyCreated event not found');
}

async function setupAllowedPayment() {
  const { walletId, vaultId } = await seedOwnerVault(harness);
  const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
  const agentWalletId = await seedWallet(harness, harness.fixture.agentAccount.address);
  const agentSession = await seedSession(harness, {
    walletId: agentWalletId,
    sessionKind: 'AGENT',
  });

  const config = directRouteConfig();
  const merchantId = `0x${'d'.repeat(64)}` as `0x${string}`;
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

  await (await import('@payguard/test-utils')).mintTokens(
    harness.fixture,
    harness.fixture.ownerAccount.address,
    5_000_000n,
  );
  const prep = await harness.built.app.inject({
    method: 'POST',
    url: `/v1/vaults/${vaultId}/transactions`,
    headers: { ...authHeaders(session), 'idempotency-key': `deposit-${vaultId}` },
    payload: { action: 'DEPOSIT', token: harness.fixture.tokenAddress, amountAtomic: '5000000' },
  });
  for (const tx of prep.json().data.transactions) {
    const hash = await harness.fixture.ownerWalletClient.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value),
      chain: null,
      account: harness.fixture.ownerAccount,
    });
    await harness.fixture.publicClient.waitForTransactionReceipt({ hash });
  }

  const invoice = {
    invoiceId: `0x${randomBytes(32).toString('hex')}` as `0x${string}`,
    merchantId,
    recipient: harness.fixture.merchantAccount.address,
    settlementToken: harness.fixture.tokenAddress,
    outputAmount: '1000000',
    category: '0',
    validUntil: '99999999999',
  };
  const vaultChain = await harness.pool.query(
    'SELECT chain_id FROM deployments d JOIN vaults v ON v.deployment_id = d.id WHERE v.id = $1',
    [vaultId],
  );
  const chainId = Number(vaultChain.rows[0].chain_id);
  const invoiceDigest = hashInvoice(
    { chainId, verifyingContract: harness.fixture.vaultAddress },
    invoice as never,
  );
  const merchantSignature = await privateKeyToAccount(MERCHANT_PRIVATE_KEY).sign({
    hash: invoiceDigest,
  });
  const invoiceResponse = await harness.built.app.inject({
    method: 'POST',
    url: '/v1/invoices',
    headers: authHeaders(session),
    payload: { vaultId, invoice, merchantSignature },
  });
  const invoiceResourceId = invoiceResponse.json().data.invoiceResourceId;

  const intent = {
    policyId: onchainPolicyId,
    invoiceHash: invoiceDigest,
    routeId: `0x${'0'.repeat(64)}` as const,
    maxInputAmount: '1000000',
    nonce: Math.floor(Math.random() * 1e9).toString(10),
    validUntil: '99999999999',
    subsidyMode: 'NONE' as const,
    maxSubsidyAmount: '0',
  };
  const intentDigest = hashIntent(
    { chainId, verifyingContract: harness.fixture.vaultAddress },
    intent as never,
  );
  const agentSignature = await privateKeyToAccount(
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  ).sign({ hash: intentDigest });
  const intentResponse = await harness.built.app.inject({
    method: 'POST',
    url: '/v1/payment-intents',
    headers: { ...authHeaders(agentSession), 'idempotency-key': 'intent-payments-test' },
    payload: { invoiceResourceId, policyResourceId: policyId, intent, agentSignature },
  });
  expect(intentResponse.statusCode).toBe(201);
  const body = intentResponse.json().data;
  expect(body.evaluation.decision).toBe('ALLOW');

  return { vaultId, session, agentSession, paymentId: body.paymentId, intentId: body.intentId };
}

describe('POST /v1/payment-intents/:id/submit -- durable queued submission', () => {
  it('queues without executing anything, honestly', async () => {
    const { session, intentId, paymentId } = await setupAllowedPayment();
    const response = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      headers: { ...authHeaders(session), 'idempotency-key': 'submit-1' },
      payload: {},
    });
    expect(response.statusCode).toBe(202);
    const body = response.json().data;
    expect(body.status).toBe('QUEUED');
    expect(body.paymentId).toBe(paymentId);
    expect(body.note).toMatch(/no payment has been executed/i);

    const operation = await harness.pool.query('SELECT status FROM operations WHERE id = $1', [
      body.operationId,
    ]);
    expect(operation.rows[0].status).toBe('QUEUED');
    const jobs = await harness.pool.query(
      'SELECT count(*)::int AS n FROM outbox WHERE event_key LIKE $1',
      [`submit:${intentId}:%`],
    );
    expect(jobs.rows[0].n).toBe(1);
  }, 20_000);

  it('is idempotent on intent identity regardless of principal: owner then bound agent get the SAME operation', async () => {
    const { session, agentSession, intentId } = await setupAllowedPayment();

    const ownerSubmit = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      headers: { ...authHeaders(session), 'idempotency-key': 'submit-owner' },
      payload: {},
    });
    expect(ownerSubmit.statusCode).toBe(202);
    const ownerOperationId = ownerSubmit.json().data.operationId;

    const agentSubmit = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      headers: { ...authHeaders(agentSession), 'idempotency-key': 'submit-agent' },
      payload: {},
    });
    expect(agentSubmit.statusCode).toBe(202);
    expect(agentSubmit.json().data.operationId).toBe(ownerOperationId);
    expect(agentSubmit.json().data.deduplicated).toBe(true);

    const jobs = await harness.pool.query(
      'SELECT count(*)::int AS n FROM outbox WHERE event_key LIKE $1',
      [`submit:${intentId}:%`],
    );
    expect(jobs.rows[0].n).toBe(1);
  }, 20_000);

  it('a NEW submit after the first operation reaches a terminal status queues a fresh job, not swallowed by the old event_key (SPEC-028)', async () => {
    const { session, intentId } = await setupAllowedPayment();

    const first = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      headers: { ...authHeaders(session), 'idempotency-key': 'submit-terminal-1' },
      payload: {},
    });
    expect(first.statusCode).toBe(202);
    const firstOperationId = first.json().data.operationId;

    // Simulate the worker having driven the first operation to a terminal FAILED status (e.g. a
    // policy re-evaluation came back BLOCK) -- `findOpenOperationForResource` excludes FAILED, so
    // a second submit call must be treated as a genuinely new command, not a replay.
    await harness.pool.query("UPDATE operations SET status = 'FAILED' WHERE id = $1", [
      firstOperationId,
    ]);

    const second = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      headers: { ...authHeaders(session), 'idempotency-key': 'submit-terminal-2' },
      payload: {},
    });
    expect(second.statusCode).toBe(202);
    const secondOperationId = second.json().data.operationId;
    expect(secondOperationId).not.toBe(firstOperationId);

    const jobs = await harness.pool.query(
      'SELECT count(*)::int AS n FROM outbox WHERE event_key LIKE $1',
      [`submit:${intentId}:%`],
    );
    expect(jobs.rows[0].n).toBe(2);
  }, 20_000);

  async function driveToUnknown(paymentId: string, reconciliation: 'NOT_CHECKED' | 'MISMATCH') {
    for (const next of ['QUEUED', 'SIGNED', 'SUBMITTED', 'UNKNOWN'] as const) {
      const payment = await getPaymentById(harness.pool, paymentId);
      if (!payment) throw new Error('payment vanished');
      await withTransaction(harness.pool, (client) =>
        updatePaymentState(client, {
          paymentId,
          expectedVersion: payment.stateVersion,
          current: {
            policyDecision: payment.policyDecision,
            executionStatus: payment.executionStatus,
            confidence: payment.confidence,
            reconciliation: payment.reconciliation,
          },
          next: { executionStatus: next },
        }),
      );
    }
    if (reconciliation === 'MISMATCH') {
      const payment = await getPaymentById(harness.pool, paymentId);
      if (!payment) throw new Error('payment vanished');
      await withTransaction(harness.pool, (client) =>
        updatePaymentState(client, {
          paymentId,
          expectedVersion: payment.stateVersion,
          current: {
            policyDecision: payment.policyDecision,
            executionStatus: payment.executionStatus,
            confidence: payment.confidence,
            reconciliation: payment.reconciliation,
          },
          next: { reconciliation: 'MISMATCH' },
        }),
      );
    }
  }

  it('SPEC-034: a reorg-regressed UNKNOWN payment (NOT_CHECKED) can be resubmitted -- it is not permanently stranded', async () => {
    const { session, intentId, paymentId } = await setupAllowedPayment();
    await driveToUnknown(paymentId, 'NOT_CHECKED');

    const response = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      headers: { ...authHeaders(session), 'idempotency-key': 'submit-unknown-resubmit' },
      payload: {},
    });
    expect(response.statusCode).toBe(202);

    const payment = await getPaymentById(harness.pool, paymentId);
    expect(payment!.executionStatus).toBe('QUEUED');
  }, 20_000);

  it('SPEC-034: an UNKNOWN payment stuck at MISMATCH is left untouched by submit -- never auto-resubmitted', async () => {
    const { session, intentId, paymentId } = await setupAllowedPayment();
    await driveToUnknown(paymentId, 'MISMATCH');

    const response = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      headers: { ...authHeaders(session), 'idempotency-key': 'submit-mismatch-noop' },
      payload: {},
    });
    // Still accepted as a command (the worker is the final enforcement point, SPEC-034), but the
    // payment's own executionStatus must NOT have silently advanced toward re-execution.
    expect(response.statusCode).toBe(202);

    const payment = await getPaymentById(harness.pool, paymentId);
    expect(payment!.executionStatus).toBe('UNKNOWN');
    expect(payment!.reconciliation).toBe('MISMATCH');
  }, 20_000);
});

describe('GET /v1/payments -- role-scoped reads', () => {
  it('the owner can read the payment detail and it is never presented as executed while QUEUED', async () => {
    const { session, paymentId } = await setupAllowedPayment();
    const response = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}`,
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.paymentId).toBe(paymentId);
    expect(body.settlement).toBeNull();
  }, 20_000);

  it('a stranger cannot read the payment (403), and an unknown id is 404', async () => {
    const { paymentId } = await setupAllowedPayment();
    const strangerWalletId = await seedWallet(harness, `0x${'f'.repeat(40)}`);
    const strangerSession = await seedSession(harness, {
      walletId: strangerWalletId,
      sessionKind: 'AGENT',
    });

    const forbidden = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}`,
      headers: authHeaders(strangerSession),
    });
    expect(forbidden.statusCode).toBe(403);

    const notFound = await harness.built.app.inject({
      method: 'GET',
      url: '/v1/payments/00000000-0000-4000-8000-000000000000',
      headers: authHeaders(strangerSession),
    });
    expect(notFound.statusCode).toBe(404);
  }, 20_000);

  it('the invoice-signing merchant can read the payment through the per-payment predicate', async () => {
    const { paymentId } = await setupAllowedPayment();
    const merchantWalletId = await seedWallet(harness, harness.fixture.merchantAccount.address);
    const merchantSession = await seedSession(harness, {
      walletId: merchantWalletId,
      sessionKind: 'AGENT',
    });

    const response = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}`,
      headers: authHeaders(merchantSession),
    });
    expect(response.statusCode).toBe(200);
  }, 20_000);

  it('lists the payment for its owner via the keyset', async () => {
    const { session, paymentId, vaultId } = await setupAllowedPayment();
    void vaultId;
    const response = await harness.built.app.inject({
      method: 'GET',
      url: '/v1/payments',
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(200);
    const ids = response.json().data.items.map((i: { paymentId: string }) => i.paymentId);
    expect(ids).toContain(paymentId);
  }, 20_000);

  it('SPEC-036: a REVERTED payment still shows its transaction hash -- gas/nonce were spent even though the invoice was not consumed', async () => {
    const { session, paymentId, intentId } = await setupAllowedPayment();

    // Drives the payment down to REVERTED with a real journaled attempt row, the exact terminal
    // state a genuine on-chain revert leaves behind, without needing a full real-chain broadcast
    // for what is specifically a READ-QUERY regression test (packages/db's own tests already cover
    // the write-side REVERTED transition through reconcileAttempt with a real receipt).
    const txHash = Buffer.from(randomBytes(32));
    const { family, attempt } = await withTransaction(harness.pool, async (client) => {
      const family = await reserveNonceFamily(client, {
        id: randomUUID(),
        deploymentId: harness.deploymentId,
        sender: addressToBuffer(harness.fixture.ownerAccount.address),
        intentId,
        unsignedRequest: {},
        expectedTo: addressToBuffer(harness.fixture.vaultAddress),
        expectedCalldataHash: Buffer.from(randomBytes(32)),
      });
      const attempt = await recordSignedAttempt(client, {
        id: randomUUID(),
        deploymentId: harness.deploymentId,
        nonceFamilyId: family.id,
        txHash,
        rawSignedTransaction: Buffer.from('02', 'hex'),
      });
      return { family, attempt };
    });

    for (const next of ['QUEUED', 'SIGNED', 'SUBMITTED', 'REVERTED'] as const) {
      const payment = await getPaymentById(harness.pool, paymentId);
      if (!payment) throw new Error('payment vanished');
      await withTransaction(harness.pool, (client) =>
        updatePaymentState(client, {
          paymentId,
          expectedVersion: payment.stateVersion,
          current: {
            policyDecision: payment.policyDecision,
            executionStatus: payment.executionStatus,
            confidence: payment.confidence,
            reconciliation: payment.reconciliation,
          },
          next: { executionStatus: next },
        }),
      );
    }
    await withTransaction(harness.pool, (client) =>
      markBroadcast(client, { attemptId: attempt.id, isFirstBroadcast: true }),
    );
    await withTransaction(harness.pool, (client) =>
      attachCanonicalReceipt(client, {
        attemptId: attempt.id,
        nonceFamilyId: family.id,
        txHash,
        state: 'REVERTED',
      }),
    );

    const response = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}`,
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.executionStatus).toBe('REVERTED');
    expect(body.transaction).not.toBeNull();
    expect(body.transaction.hash.toLowerCase()).toBe(`0x${txHash.toString('hex')}`);
  }, 20_000);
});

describe('GET /v1/transactions/:hash', () => {
  it('404s for an unknown transaction hash', async () => {
    const { session } = await setupAllowedPayment();
    const response = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/transactions/0x${'0'.repeat(64)}?deploymentId=${harness.deploymentId}`,
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(404);
  }, 20_000);

  it('rejects a deploymentId that is not the active deployment', async () => {
    const { session } = await setupAllowedPayment();
    const response = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/transactions/0x${'0'.repeat(64)}?deploymentId=00000000-0000-4000-8000-000000000000`,
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('DEPLOYMENT_MISMATCH');
  }, 20_000);
});
