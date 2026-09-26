/**
 * Stage 5 item 7's "full public-API payment demonstration": the real Fastify app (`app.inject()`,
 * exercising the ENTIRE request pipeline exactly like a live HTTP call -- routing, auth, schema
 * validation, error handling) driving a payment from SIWE login through real HTTP calls into SQL,
 * with the REAL Stage 5 worker (`@payguard/worker`, imported as a devDependency for this one
 * cross-process test, mirroring SPEC-027's precedent of `packages/chain` importing
 * `@payguard/integration`) performing the actual sign/broadcast/reconcile against the SAME real
 * Postgres + Anvil, and a final real authenticated GET reading the receipt-backed result back.
 *
 * Scope: policy creation and the owner's deposit are seeded the same direct-chain-plus-SQL way
 * every other real-chain test in this repo already does -- those specific paths (`POST
 * /v1/policy-drafts(/transaction)`, `POST /v1/vaults/:id/transactions`) are Stage 4 concerns
 * already exercised through real HTTP in `apps/api/test/policies.test.ts` and
 * `apps/api/test/vaults.test.ts`. What is NEW to Stage 5 -- invoice ingestion, intent creation,
 * durable submission, and the worker's sign/broadcast/settle path -- all goes through real HTTP end
 * to end here, which is the part this checkpoint actually needs to prove.
 */
import { randomUUID } from 'node:crypto';
import { createLocalPublicClient, PAYGUARD_VAULT_ABI, prepareCreatePolicy } from '@payguard/chain';
import { claimDueJobs, getOutboxById, type OutboxRow, retryJob } from '@payguard/db';
import {
  domainFor,
  hashIntent,
  hashInvoice,
  type Invoice,
  type PaymentIntent,
} from '@payguard/domain';
import {
  AGENT_PRIVATE_KEY,
  MERCHANT_PRIVATE_KEY,
  mintTokens,
  RELAYER_PRIVATE_KEY,
} from '@payguard/test-utils';
import { loadWorkerConfig } from '@payguard/worker/src/config.js';
import {
  createSubmitDeps,
  handlePaymentSubmissionJob,
} from '@payguard/worker/src/submitPayment.js';
import { decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestHarness,
  seedOwnerVault,
  seedPolicy,
  type TestHarness,
} from './helpers/testApp.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
}, 60_000);

afterAll(async () => {
  await harness.stopAnvil();
}, 30_000);

async function loginViaRealHttp(
  harness: TestHarness,
  privateKey: `0x${string}`,
  sessionKind: 'AGENT' | 'BROWSER',
): Promise<{ accessToken?: string; walletAddress: string }> {
  const account = privateKeyToAccount(privateKey);
  const challengeResponse = await harness.built.app.inject({
    method: 'POST',
    url: '/v1/auth/challenges',
    payload: { address: account.address, chainId: '31337', sessionKind },
  });
  expect(challengeResponse.statusCode).toBe(201);
  const { data: challenge } = challengeResponse.json();
  const signature = await account.signMessage({ message: challenge.message });
  const verifyResponse = await harness.built.app.inject({
    method: 'POST',
    url: '/v1/auth/verify',
    payload: { challengeId: challenge.challengeId, signature },
  });
  expect(verifyResponse.statusCode).toBe(201);
  const body = verifyResponse.json().data;
  return { accessToken: body.accessToken, walletAddress: account.address };
}

/** A bounded outbox-drain loop against the REAL worker handler, exactly what apps/worker/src/main.ts does on an interval. */
async function driveOutboxToCompletion(harness: TestHarness, jobId: string): Promise<void> {
  const workerConfig = loadWorkerConfig({
    DATABASE_URL: 'unused',
    RPC_URL: harness.fixture.rpcUrl,
    CHAIN_ID: '31337',
    PAYGUARD_DEPLOYMENT_ID: harness.deploymentId,
    RELAYER_PRIVATE_KEY,
    WORKER_RECEIPT_POLL_ATTEMPTS: '10',
    WORKER_RECEIPT_POLL_INTERVAL_MS: '200',
  });
  const publicClient = createLocalPublicClient({ rpcUrl: harness.fixture.rpcUrl, chainId: 31337 });
  const submitDeps = createSubmitDeps({ pool: harness.pool, publicClient, config: workerConfig });

  for (let i = 0; i < 40; i++) {
    const [job] = await claimDueJobs(harness.pool, {
      leaseOwner: randomUUID(),
      leaseDurationSeconds: 60,
      limit: 1,
    });
    if (job) {
      try {
        const result = await handlePaymentSubmissionJob(submitDeps, {
          id: job.id,
          leaseOwner: job.leaseOwner!,
          leaseVersion: job.leaseVersion,
          payload: job.payload as { intentId: string; paymentId: string; operationId: string },
        });
        if (result.kind !== 'DONE') {
          await retryJob(harness.pool, {
            id: job.id,
            leaseOwner: job.leaseOwner!,
            expectedLeaseVersion: job.leaseVersion,
            error: result.reason,
            maxAttempts: 20,
            backoffSeconds: 1,
          });
        }
      } catch (error) {
        await retryJob(harness.pool, {
          id: job.id,
          leaseOwner: job.leaseOwner!,
          expectedLeaseVersion: job.leaseVersion,
          error: error instanceof Error ? error.message : String(error),
          maxAttempts: 20,
          backoffSeconds: 1,
        });
      }
    }
    const current: OutboxRow | null = await getOutboxById(harness.pool, jobId);
    if (current && (current.status === 'DONE' || current.status === 'DEAD')) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

describe('Full public-API payment demonstration: real HTTP -> SQL -> worker-relayed transaction -> receipt -> authorized GET', () => {
  it('an agent creates an invoice and intent, submits it over real HTTP, the real worker settles it on-chain, and an authenticated GET reads the receipt-backed result', async () => {
    const { vaultId } = await seedOwnerVault(harness);

    const agentSession = await loginViaRealHttp(harness, AGENT_PRIVATE_KEY, 'AGENT');
    expect(agentSession.accessToken).toBeTruthy();
    const agentAuthHeaders = { authorization: `Bearer ${agentSession.accessToken}` };

    // Real on-chain policy (policy creation itself is already proven reachable via HTTP in Stage
    // 4's policies.test.ts -- out of scope for THIS test, which is about the Stage 5 worker path).
    const config = {
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
    const merchantId = `0x${'f'.repeat(64)}` as `0x${string}`;
    const prepared = prepareCreatePolicy(
      {
        chainId: '31337',
        ownerAddress: harness.fixture.ownerAccount.address,
        vaultAddress: harness.fixture.vaultAddress,
      },
      // biome-ignore lint/suspicious/noExplicitAny: fixture shape matches PolicyConfig exactly
      config as any,
      [
        {
          merchantId,
          recipient: harness.fixture.merchantAccount.address,
          invoiceSigner: harness.fixture.merchantAccount.address,
          category: '0',
        },
      ] as never,
    );
    const createPolicyHash = await harness.fixture.ownerWalletClient.sendTransaction({
      to: prepared.transaction.to as `0x${string}`,
      data: prepared.transaction.data as `0x${string}`,
      value: 0n,
      chain: null,
      account: harness.fixture.ownerAccount,
    });
    const createPolicyReceipt = await harness.fixture.publicClient.waitForTransactionReceipt({
      hash: createPolicyHash,
    });
    let onchainPolicyId: `0x${string}` | null = null;
    for (const log of createPolicyReceipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: PAYGUARD_VAULT_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'PolicyCreated') {
          onchainPolicyId = (decoded.args as { policyId: `0x${string}` }).policyId;
        }
      } catch {
        // not this event
      }
    }
    if (!onchainPolicyId) throw new Error('PolicyCreated event not found');

    const { policyId } = await seedPolicy(harness, {
      vaultId,
      onchainPolicyId,
      config,
      merchants: [
        {
          merchantId,
          recipient: harness.fixture.merchantAccount.address,
          invoiceSigner: harness.fixture.merchantAccount.address,
          category: 0,
        },
      ],
    });

    // Real owner deposit (mint -> approve -> deposit), same as every other real-chain test here --
    // POST /v1/vaults/:id/transactions is Stage 4's own owner-transaction-prep route, out of scope.
    await mintTokens(harness.fixture, harness.fixture.ownerAccount.address, 5_000_000n);
    const approveHash = await harness.fixture.ownerWalletClient.writeContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'approve',
      args: [harness.fixture.vaultAddress, 5_000_000n],
      chain: null,
      account: harness.fixture.ownerAccount,
    } as never);
    await harness.fixture.publicClient.waitForTransactionReceipt({ hash: approveHash });
    const depositHash = await harness.fixture.ownerWalletClient.writeContract({
      address: harness.fixture.vaultAddress,
      abi: PAYGUARD_VAULT_ABI,
      functionName: 'deposit',
      args: [harness.fixture.tokenAddress, 5_000_000n],
      chain: null,
      account: harness.fixture.ownerAccount,
    } as never);
    await harness.fixture.publicClient.waitForTransactionReceipt({ hash: depositHash });

    // --- Real HTTP from here on: invoice -> intent -> submit -> (worker) -> authenticated GET ---

    const invoice: Invoice = {
      invoiceId: `0x${randomUUID().replace(/-/g, '').padEnd(64, '0')}` as `0x${string}`,
      merchantId,
      recipient: harness.fixture.merchantAccount.address,
      settlementToken: harness.fixture.tokenAddress,
      outputAmount: '1000000',
      category: '0',
      validUntil: '99999999999',
    };
    const eip712Domain = { chainId: 31337, verifyingContract: harness.fixture.vaultAddress };
    const invoiceDigest = hashInvoice(eip712Domain, invoice);
    const merchantAccount = privateKeyToAccount(MERCHANT_PRIVATE_KEY);
    const merchantSignature = await merchantAccount.sign({ hash: invoiceDigest });

    const invoiceResponse = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/invoices',
      headers: agentAuthHeaders,
      payload: { vaultId, invoice, merchantSignature },
    });
    expect(invoiceResponse.statusCode).toBe(201);
    const { invoiceResourceId, signatureValid } = invoiceResponse.json().data;
    expect(signatureValid).toBe(true);

    const intent: PaymentIntent = {
      policyId: onchainPolicyId,
      invoiceHash: invoiceDigest,
      routeId: `0x${'0'.repeat(64)}` as `0x${string}`,
      maxInputAmount: '1000000',
      nonce: Math.floor(Math.random() * 1e9).toString(10),
      validUntil: '99999999999',
      subsidyMode: 'NONE',
      maxSubsidyAmount: '0',
    };
    const intentDigest = hashIntent(eip712Domain, intent);
    const agentAccount = privateKeyToAccount(AGENT_PRIVATE_KEY);
    const agentSignature = await agentAccount.sign({ hash: intentDigest });

    const intentResponse = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: { ...agentAuthHeaders, 'idempotency-key': randomUUID() },
      payload: { invoiceResourceId, policyResourceId: policyId, intent, agentSignature },
    });
    expect(intentResponse.statusCode).toBe(201);
    const { paymentId, intentId, evaluation } = intentResponse.json().data;
    expect(evaluation.decision).toBe('ALLOW');

    const submitResponse = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      headers: { ...agentAuthHeaders, 'idempotency-key': randomUUID() },
      payload: {},
    });
    expect(submitResponse.statusCode).toBe(202);
    const { operationId } = submitResponse.json().data;
    expect(operationId).toBeTruthy();

    const jobRow = await harness.pool.query(
      "SELECT id FROM outbox WHERE aggregate_id = $1 AND event_type = 'PAYMENT_SUBMISSION_REQUESTED' ORDER BY created_at DESC LIMIT 1",
      [intentId],
    );
    const jobId = jobRow.rows[0].id as string;

    const balanceBefore = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;

    // The REAL Stage 5 worker path: claim -> evaluate -> simulate -> sign -> broadcast -> reconcile.
    await driveOutboxToCompletion(harness, jobId);

    const balanceAfter = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;
    expect(balanceAfter - balanceBefore).toBe(1_000_000n);

    // Final authenticated read, real HTTP, receipt-backed.
    const getResponse = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}`,
      headers: agentAuthHeaders,
    });
    expect(getResponse.statusCode).toBe(200);
    const paymentBody = getResponse.json().data;
    expect(paymentBody.executionStatus).toBe('SUCCEEDED');
    expect(paymentBody.reconciliation).toBe('MATCHED');
    expect(paymentBody.settlement.outputDeliveredAtomic).toBe('1000000');
    expect(paymentBody.transaction.hash).toMatch(/^0x[0-9a-f]{64}$/);

    // The transaction the API reports really exists on-chain with a successful receipt -- the API
    // never fabricates this from an adapter return value or a log with the wrong emitter.
    const onchainReceipt = await harness.fixture.publicClient.getTransactionReceipt({
      hash: paymentBody.transaction.hash as `0x${string}`,
    });
    expect(onchainReceipt.status).toBe('success');
    expect(onchainReceipt.to?.toLowerCase()).toBe(harness.fixture.vaultAddress.toLowerCase());
  }, 60_000);

  it('SPEC-036: settlement.actualInputAtomic is the REAL decoded on-chain amount, not the signed authorization ceiling', async () => {
    const { vaultId } = await seedOwnerVault(harness);
    const agentSession = await loginViaRealHttp(harness, AGENT_PRIVATE_KEY, 'AGENT');
    const agentAuthHeaders = { authorization: `Bearer ${agentSession.accessToken}` };

    const config = {
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
    const merchantId = `0x${'a'.repeat(64)}` as `0x${string}`;
    const prepared = prepareCreatePolicy(
      {
        chainId: '31337',
        ownerAddress: harness.fixture.ownerAccount.address,
        vaultAddress: harness.fixture.vaultAddress,
      },
      // biome-ignore lint/suspicious/noExplicitAny: fixture shape matches PolicyConfig exactly
      config as any,
      [
        {
          merchantId,
          recipient: harness.fixture.merchantAccount.address,
          invoiceSigner: harness.fixture.merchantAccount.address,
          category: '0',
        },
      ] as never,
    );
    const createPolicyHash = await harness.fixture.ownerWalletClient.sendTransaction({
      to: prepared.transaction.to as `0x${string}`,
      data: prepared.transaction.data as `0x${string}`,
      value: 0n,
      chain: null,
      account: harness.fixture.ownerAccount,
    });
    const createPolicyReceipt = await harness.fixture.publicClient.waitForTransactionReceipt({
      hash: createPolicyHash,
    });
    let onchainPolicyId: `0x${string}` | null = null;
    for (const log of createPolicyReceipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: PAYGUARD_VAULT_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'PolicyCreated') {
          onchainPolicyId = (decoded.args as { policyId: `0x${string}` }).policyId;
        }
      } catch {
        // not this event
      }
    }
    if (!onchainPolicyId) throw new Error('PolicyCreated event not found');

    const { policyId } = await seedPolicy(harness, {
      vaultId,
      onchainPolicyId,
      config,
      merchants: [
        {
          merchantId,
          recipient: harness.fixture.merchantAccount.address,
          invoiceSigner: harness.fixture.merchantAccount.address,
          category: 0,
        },
      ],
    });

    await mintTokens(harness.fixture, harness.fixture.ownerAccount.address, 5_000_000n);
    const approveHash = await harness.fixture.ownerWalletClient.writeContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'approve',
      args: [harness.fixture.vaultAddress, 5_000_000n],
      chain: null,
      account: harness.fixture.ownerAccount,
    } as never);
    await harness.fixture.publicClient.waitForTransactionReceipt({ hash: approveHash });
    const depositHash = await harness.fixture.ownerWalletClient.writeContract({
      address: harness.fixture.vaultAddress,
      abi: PAYGUARD_VAULT_ABI,
      functionName: 'deposit',
      args: [harness.fixture.tokenAddress, 5_000_000n],
      chain: null,
      account: harness.fixture.ownerAccount,
    } as never);
    await harness.fixture.publicClient.waitForTransactionReceipt({ hash: depositHash });

    const invoice: Invoice = {
      invoiceId: `0x${randomUUID().replace(/-/g, '').padEnd(64, '0')}` as `0x${string}`,
      merchantId,
      recipient: harness.fixture.merchantAccount.address,
      settlementToken: harness.fixture.tokenAddress,
      outputAmount: '1000000',
      category: '0',
      validUntil: '99999999999',
    };
    const eip712Domain = { chainId: 31337, verifyingContract: harness.fixture.vaultAddress };
    const invoiceDigest = hashInvoice(eip712Domain, invoice);
    const merchantAccount = privateKeyToAccount(MERCHANT_PRIVATE_KEY);
    const merchantSignature = await merchantAccount.sign({ hash: invoiceDigest });

    const invoiceResponse = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/invoices',
      headers: agentAuthHeaders,
      payload: { vaultId, invoice, merchantSignature },
    });
    expect(invoiceResponse.statusCode).toBe(201);
    const { invoiceResourceId } = invoiceResponse.json().data;

    // The direct route settles input == output 1:1 exactly (exact-output, no swap/slippage), so a
    // maxInputAmount CEILING set well above the invoice's outputAmount only ever functions as
    // authorized headroom -- the decoded on-chain `actualInput` must still come back as exactly the
    // output amount, never the ceiling itself.
    const intent: PaymentIntent = {
      policyId: onchainPolicyId,
      invoiceHash: invoiceDigest,
      routeId: `0x${'0'.repeat(64)}` as `0x${string}`,
      maxInputAmount: '2000000',
      nonce: Math.floor(Math.random() * 1e9).toString(10),
      validUntil: '99999999999',
      subsidyMode: 'NONE',
      maxSubsidyAmount: '0',
    };
    const intentDigest = hashIntent(eip712Domain, intent);
    const agentAccount = privateKeyToAccount(AGENT_PRIVATE_KEY);
    const agentSignature = await agentAccount.sign({ hash: intentDigest });

    const intentResponse = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: { ...agentAuthHeaders, 'idempotency-key': randomUUID() },
      payload: { invoiceResourceId, policyResourceId: policyId, intent, agentSignature },
    });
    expect(intentResponse.statusCode).toBe(201);
    const { paymentId, intentId, evaluation } = intentResponse.json().data;
    expect(evaluation.decision).toBe('ALLOW');

    const submitResponse = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      headers: { ...agentAuthHeaders, 'idempotency-key': randomUUID() },
      payload: {},
    });
    expect(submitResponse.statusCode).toBe(202);

    const jobRow = await harness.pool.query(
      "SELECT id FROM outbox WHERE aggregate_id = $1 AND event_type = 'PAYMENT_SUBMISSION_REQUESTED' ORDER BY created_at DESC LIMIT 1",
      [intentId],
    );
    const jobId = jobRow.rows[0].id as string;
    await driveOutboxToCompletion(harness, jobId);

    const getResponse = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}`,
      headers: agentAuthHeaders,
    });
    expect(getResponse.statusCode).toBe(200);
    const paymentBody = getResponse.json().data;
    expect(paymentBody.executionStatus).toBe('SUCCEEDED');
    // The real decoded amount actually pulled by the vault -- NOT '2000000', the signed ceiling.
    expect(paymentBody.settlement.actualInputAtomic).toBe('1000000');
    expect(paymentBody.settlement.outputDeliveredAtomic).toBe('1000000');
  }, 60_000);
});
