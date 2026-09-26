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
  createIntentVersion,
  createSignedArtifact,
  getPaymentById,
  markBroadcast,
  recordBlock,
  recordEvent,
  recordSignedAttempt,
  reserveNonceFamily,
  updatePaymentState,
  withTransaction,
} from '@payguard/db';
import { hashIntent, hashInvoice } from '@payguard/domain';
import { MERCHANT_PRIVATE_KEY } from '@payguard/test-utils';
import Ajv from 'ajv';
import { decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addressToBuffer } from '../src/auth.js';
import { PAYMENT_VIEW_SCHEMA, TRANSACTION_VIEW_SCHEMA } from '../src/schemas.js';
import {
  authHeaders,
  createTestHarness,
  seedOwnerVault,
  seedPolicy,
  seedSession,
  seedWallet,
  type TestHarness,
} from './helpers/testApp.js';

const ajv = new Ajv({ strict: false });
const validatePaymentView = ajv.compile(PAYMENT_VIEW_SCHEMA);
const validateTransactionView = ajv.compile(TRANSACTION_VIEW_SCHEMA);

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

describe('B1 read-model correctness (INT-006..INT-011)', () => {
  it('a not-yet-settled payment already reports the wire-shaped authorized.inputToken/routeId from its active intent, and the full body matches PAYMENT_VIEW_SCHEMA', async () => {
    const { session, paymentId } = await setupAllowedPayment();
    const response = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}`,
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(validatePaymentView(body)).toBe(true);
    expect(body.authorized.inputToken.toLowerCase()).toBe(
      harness.fixture.tokenAddress.toLowerCase(),
    );
    expect(body.authorized.routeId).toBe(`0x${'0'.repeat(64)}`);
  }, 20_000);

  it('INT-007: a payment that actually settled under intent v1 keeps showing v1s authorized/settlement fields after the intent is re-versioned to v2 -- never silently reassembled from whichever intent happens to be active now', async () => {
    const { session, paymentId, intentId, vaultId } = await setupAllowedPayment();

    // Drive the payment to a REAL SUCCEEDED settlement under intent v1, with real chain_blocks +
    // chain_events rows exactly like a real `reconcileAttempt` would have written.
    const txHash = Buffer.from(randomBytes(32));
    const blockHash = Buffer.from(randomBytes(32));
    const actualInput = '999000';
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
      await recordBlock(client, {
        deploymentId: harness.deploymentId,
        blockHash,
        blockNumber: 42n,
        parentHash: Buffer.alloc(32, 0),
        canonical: true,
        confidence: 'LOCAL_DEMO',
      });
      await recordEvent(client, {
        deploymentId: harness.deploymentId,
        blockHash,
        logIndex: 0n,
        txHash,
        emitter: addressToBuffer(harness.fixture.vaultAddress),
        topic0: Buffer.alloc(32, 1),
        topics: [],
        data: Buffer.alloc(0),
        decodedName: 'PaymentExecuted',
        decodedPayload: { actualInput, exactOutput: '1000000', subsidyAmount: '0' },
        canonical: true,
      });
      return { family, attempt };
    });

    for (const next of ['QUEUED', 'SIGNED', 'SUBMITTED'] as const) {
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
        state: 'SUCCEEDED',
      }),
    );
    const settled = await getPaymentById(harness.pool, paymentId);
    if (!settled) throw new Error('payment vanished');
    await withTransaction(harness.pool, (client) =>
      updatePaymentState(client, {
        paymentId,
        expectedVersion: settled.stateVersion,
        current: {
          policyDecision: settled.policyDecision,
          executionStatus: 'SUBMITTED',
          confidence: settled.confidence,
          reconciliation: settled.reconciliation,
        },
        next: {
          executionStatus: 'SUCCEEDED',
          confidence: 'LOCAL_DEMO',
          reconciliation: 'MATCHED',
          observedBlockHash: blockHash,
        },
      }),
    );

    // NOW re-version the intent (as a legitimate agent resubmission would): v1 retires, v2 exists.
    const artifactId = randomUUID();
    await withTransaction(harness.pool, (client) =>
      createSignedArtifact(client, {
        id: artifactId,
        kind: 'INTENT',
        digest: Buffer.from(randomBytes(32)),
        signer: addressToBuffer(harness.fixture.agentAccount.address),
        encodedPayload: Buffer.alloc(0),
        typedData: {},
        signature: Buffer.alloc(65, 1),
        signatureHash: Buffer.from(randomBytes(32)),
        schemaVersion: '1',
      }),
    );
    const v1 = await withTransaction(harness.pool, (client) =>
      client.query('SELECT policy_id, vault_id FROM payment_intents WHERE id = $1', [intentId]),
    );
    const policyId = v1.rows[0].policy_id as string;
    await withTransaction(harness.pool, (client) =>
      createIntentVersion(client, {
        id: randomUUID(),
        paymentId,
        vaultId,
        policyId,
        version: 2n,
        intentDigest: Buffer.from(randomBytes(32)),
        artifactId,
        agentNonce: 999999n,
        maxInputAmount: 1n,
        validUntil: 99999999999n,
      }),
    );

    // Confirm intent v1 is genuinely retired now (the precondition this test is actually about).
    const retiredCheck = await harness.pool.query(
      'SELECT retired_at FROM payment_intents WHERE id = $1',
      [intentId],
    );
    expect(retiredCheck.rows[0].retired_at).not.toBeNull();

    const response = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}`,
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(validatePaymentView(body)).toBe(true);
    // The historically-correct intent (v1, now retired) must still be the one reflected here --
    // NOT v2 (which never settled anything and carries a different maxInputAmount).
    expect(body.intentId).toBe(intentId);
    expect(body.authorized.maxInputAtomic).toBe('1000000');
    expect(body.authorized.inputToken.toLowerCase()).toBe(
      harness.fixture.tokenAddress.toLowerCase(),
    );
    expect(body.authorized.routeId).toBe(`0x${'0'.repeat(64)}`);
    expect(body.settlement.actualInputAtomic).toBe(actualInput);
    expect(body.observedAt.blockNumber).toBe('42');
    expect(body.observedAt.canonical).toBe(true);

    // A subsequent reorg flips this exact block non-canonical. Evidence (the block/hash) must
    // stay visible -- it must NOT be erased -- but must honestly stop claiming canonicality, and
    // settlement must clear once executionStatus leaves SUCCEEDED (mirrors what
    // apps/worker/src/indexer.ts's regressAffectedPayments actually does on a real reorg).
    await harness.pool.query(
      'UPDATE chain_blocks SET canonical = false WHERE deployment_id = $1 AND block_hash = $2',
      [harness.deploymentId, blockHash],
    );
    const preReorg = await getPaymentById(harness.pool, paymentId);
    if (!preReorg) throw new Error('payment vanished');
    await withTransaction(harness.pool, (client) =>
      updatePaymentState(client, {
        paymentId,
        expectedVersion: preReorg.stateVersion,
        current: {
          policyDecision: preReorg.policyDecision,
          executionStatus: 'SUCCEEDED',
          confidence: preReorg.confidence,
          reconciliation: preReorg.reconciliation,
        },
        next: { executionStatus: 'REORGED', confidence: 'UNOBSERVED' },
      }),
    );
    const reorged = await getPaymentById(harness.pool, paymentId);
    if (!reorged) throw new Error('payment vanished');
    await withTransaction(harness.pool, (client) =>
      updatePaymentState(client, {
        paymentId,
        expectedVersion: reorged.stateVersion,
        current: {
          policyDecision: reorged.policyDecision,
          executionStatus: 'REORGED',
          confidence: 'UNOBSERVED',
          reconciliation: reorged.reconciliation,
        },
        next: {
          executionStatus: 'UNKNOWN',
          reasonCode: 'ORPHANED_BLOCK',
          reconciliation: 'NOT_CHECKED',
        },
      }),
    );

    const afterReorg = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}`,
      headers: authHeaders(session),
    });
    const reorgBody = afterReorg.json().data;
    expect(validatePaymentView(reorgBody)).toBe(true);
    expect(reorgBody.executionStatus).toBe('UNKNOWN');
    expect(reorgBody.settlement).toBeNull();
    // Evidence preserved, honestly reported as no-longer-canonical.
    expect(reorgBody.observedAt).not.toBeNull();
    expect(reorgBody.observedAt.blockHash.toLowerCase()).toBe(`0x${blockHash.toString('hex')}`);
    expect(reorgBody.observedAt.blockNumber).toBe('42');
    expect(reorgBody.observedAt.canonical).toBe(false);
  }, 30_000);

  it('INT-008: GET /v1/transactions/:hash reports real from/nonce/canonicalReceiptIdentity, and replacementOf is a real tx hash, never a raw attempt UUID', async () => {
    const { session, paymentId, intentId } = await setupAllowedPayment();

    const firstHash = Buffer.from(randomBytes(32));
    const replacementHash = Buffer.from(randomBytes(32));
    const blockHash = Buffer.from(randomBytes(32));
    const sender = addressToBuffer(harness.fixture.ownerAccount.address);

    const { family, replacementAttempt } = await withTransaction(harness.pool, async (client) => {
      const family = await reserveNonceFamily(client, {
        id: randomUUID(),
        deploymentId: harness.deploymentId,
        sender,
        intentId,
        unsignedRequest: {},
        expectedTo: addressToBuffer(harness.fixture.vaultAddress),
        expectedCalldataHash: Buffer.from(randomBytes(32)),
      });
      const firstAttempt = await recordSignedAttempt(client, {
        id: randomUUID(),
        deploymentId: harness.deploymentId,
        nonceFamilyId: family.id,
        txHash: firstHash,
        rawSignedTransaction: Buffer.from('02', 'hex'),
      });
      // A real fee-bump replacement: a NEW attempt row, `replacement_of_id` pointing back at the
      // first attempt's UUID -- exactly what a wire response must resolve to a hash, not echo raw.
      const replacementAttempt = await client.query(
        `INSERT INTO transaction_attempts (id, deployment_id, nonce_family_id, tx_hash, raw_signed_transaction, replacement_of_id, state)
         VALUES ($1,$2,$3,$4,$5,$6,'SUBMITTED') RETURNING *`,
        [
          randomUUID(),
          harness.deploymentId,
          family.id,
          replacementHash,
          Buffer.from('03', 'hex'),
          firstAttempt.id,
        ],
      );
      await recordBlock(client, {
        deploymentId: harness.deploymentId,
        blockHash,
        blockNumber: 7n,
        parentHash: Buffer.alloc(32, 0),
        canonical: true,
        confidence: 'LOCAL_DEMO',
      });
      await client.query(
        `INSERT INTO receipts (deployment_id, tx_hash, block_hash, receipt_status, canonical, raw_receipt)
         VALUES ($1,$2,$3,1,true,'{}')`,
        [harness.deploymentId, replacementHash, blockHash],
      );
      return { family, replacementAttempt: replacementAttempt.rows[0] };
    });
    void replacementAttempt;

    const response = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/transactions/0x${replacementHash.toString('hex')}?deploymentId=${harness.deploymentId}`,
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(validateTransactionView(body)).toBe(true);
    expect(body.from.toLowerCase()).toBe(harness.fixture.ownerAccount.address.toLowerCase());
    expect(body.nonce).toBe(String(family.nonce));
    expect(body.replacementOf.toLowerCase()).toBe(`0x${firstHash.toString('hex')}`);
    // Never the raw UUID leaking onto the wire as if it were a hash.
    expect(body.replacementOf).not.toMatch(/^0x[0-9a-f]{8}-/);
    expect(body.canonicalReceiptIdentity).not.toBeNull();
    expect(body.canonicalReceiptIdentity.blockNumber).toBe('7');
    expect(body.canonicalReceiptIdentity.canonical).toBe(true);
    void paymentId;
  }, 20_000);
});
