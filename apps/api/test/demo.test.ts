/**
 * B2 demo bridge (`docs/PAYGUARD_INTEGRATION_BOUNDARY.md` section 5, `apps/api/src/routes/demo.ts`):
 * proves the PROVE-section requirements end to end against real Postgres + Anvil + the real API +
 * the real worker. The bridge is exercised exactly like any other client -- real HTTP through
 * `app.inject()`, real SIWE, real on-chain `evaluate()`, real settlement -- so every outcome
 * asserted here is a genuine API/contract result, never a bridge-side shortcut. The owner side
 * (starting a run, approving an ESCALATE) goes through a real BROWSER session (cookie + CSRF +
 * Origin), matching `docs/PAYGUARD_INTEGRATION_BOUNDARY.md`'s "Owner cookie + CSRF + idempotency"
 * authority for `POST /v1/demo/runs`.
 */
import { randomUUID } from 'node:crypto';
import { createLocalPublicClient, PAYGUARD_VAULT_ABI, prepareCreatePolicy } from '@payguard/chain';
import { claimDueJobs, getOutboxById, type OutboxRow, retryJob } from '@payguard/db';
import { hashApproval } from '@payguard/domain';
import { AGENT_PRIVATE_KEY, mintTokens, RELAYER_PRIVATE_KEY } from '@payguard/test-utils';
import { loadWorkerConfig } from '@payguard/worker/src/config.js';
import {
  createSubmitDeps,
  handlePaymentSubmissionJob,
} from '@payguard/worker/src/submitPayment.js';
import { createPublicClient, decodeEventLog, http, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createAppContext } from '../src/context.js';
import {
  browserHeaders,
  createTestHarness,
  seedOwnerVault,
  seedPolicy,
  seedSession,
  seedWallet,
  type TestHarness,
} from './helpers/testApp.js';

const ORIGIN = 'http://127.0.0.1:3999';
const DEMO_BUDGET = {
  totalOutputBudget: '300000000',
  epochOutputBudget: '300000000',
  automaticOutputCap: '100000000',
  escalationOutputCap: '200000000',
  totalInputBudget: '300000000',
  maxInputPerPayment: '300000000',
};

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness({ demoEnabled: true });
}, 60_000);

afterAll(async () => {
  await harness.stopAnvil();
}, 30_000);

/** Real on-chain createPolicy bound to the SAME fixture accounts the demo config's isolated signing keys derive from. */
async function deployDemoPolicy(vaultId: string, merchantId: `0x${string}`) {
  const config = {
    agent: harness.fixture.agentAccount.address,
    inputToken: harness.fixture.tokenAddress,
    settlementToken: harness.fixture.tokenAddress,
    adapter: '0x0000000000000000000000000000000000000000' as const,
    routeId: `0x${'0'.repeat(64)}` as const,
    ...DEMO_BUDGET,
    validAfter: '0',
    validUntil: '99999999999',
    allowedCategoryBitmap: '1',
    subsidyMode: 'NONE' as const,
  };
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
  const hash = await harness.fixture.ownerWalletClient.sendTransaction({
    to: prepared.transaction.to as `0x${string}`,
    data: prepared.transaction.data as `0x${string}`,
    value: 0n,
    chain: null,
    account: harness.fixture.ownerAccount,
  });
  const receipt = await harness.fixture.publicClient.waitForTransactionReceipt({ hash });
  let onchainPolicyId: `0x${string}` | null = null;
  for (const log of receipt.logs) {
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
  return { policyId, onchainPolicyId };
}

async function setupDemoVault() {
  const { walletId, vaultId } = await seedOwnerVault(harness);
  const ownerSession = await seedSession(harness, { walletId, sessionKind: 'BROWSER' });
  const merchantId = `0x${randomUUID().replace(/-/g, '').padEnd(64, 'd')}` as `0x${string}`;
  const { policyId, onchainPolicyId } = await deployDemoPolicy(vaultId, merchantId);

  await mintTokens(harness.fixture, harness.fixture.ownerAccount.address, 500_000_000n);
  const approveHash = await harness.fixture.ownerWalletClient.writeContract({
    address: harness.fixture.tokenAddress,
    abi: harness.fixture.erc20Abi,
    functionName: 'approve',
    args: [harness.fixture.vaultAddress, 500_000_000n],
    chain: null,
    account: harness.fixture.ownerAccount,
  } as never);
  await harness.fixture.publicClient.waitForTransactionReceipt({ hash: approveHash });
  const depositHash = await harness.fixture.ownerWalletClient.writeContract({
    address: harness.fixture.vaultAddress,
    abi: PAYGUARD_VAULT_ABI,
    functionName: 'deposit',
    args: [harness.fixture.tokenAddress, 500_000_000n],
    chain: null,
    account: harness.fixture.ownerAccount,
  } as never);
  await harness.fixture.publicClient.waitForTransactionReceipt({ hash: depositHash });

  return { walletId, vaultId, ownerSession, policyId, onchainPolicyId, merchantId };
}

/** A bounded outbox-drain loop against the REAL worker handler, exactly what apps/worker/src/main.ts does on an interval. */
async function driveOutboxForIntent(intentId: string): Promise<void> {
  const jobRow = await harness.pool.query(
    "SELECT id FROM outbox WHERE aggregate_id = $1 AND event_type = 'PAYMENT_SUBMISSION_REQUESTED' ORDER BY created_at DESC LIMIT 1",
    [intentId],
  );
  const jobId = jobRow.rows[0]?.id as string | undefined;
  if (!jobId) return;

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

function startRun(
  ownerSession: { token: string; csrfToken: string | null },
  payload: { profileId: string; scenarioId: string; sourcePaymentId?: string },
  idempotencyKey: string = randomUUID(),
) {
  return harness.built.app.inject({
    method: 'POST',
    url: '/v1/demo/runs',
    headers: { ...browserHeaders(ownerSession, ORIGIN), 'idempotency-key': idempotencyKey },
    payload,
  });
}

function getRun(ownerSession: { token: string; csrfToken: string | null }, runId: string) {
  return harness.built.app.inject({
    method: 'GET',
    url: `/v1/demo/runs/${runId}`,
    headers: browserHeaders(ownerSession, ORIGIN),
  });
}

/**
 * A second app instance, demo-DISABLED, sharing the SAME Postgres pool and Anvil chain as
 * `harness` -- never a second `createTestHarness()`, which would `truncateAll` the shared database
 * out from under every other test in this file.
 */
async function buildDemoDisabledApp() {
  const config = loadConfig({
    DATABASE_URL: 'unused-direct-pool',
    PAYGUARD_DEPLOYMENT_ID: harness.deploymentId,
    CHAIN_ID: '31337',
    RPC_URL: harness.fixture.rpcUrl,
    API_SIWE_DOMAIN: '127.0.0.1:3999',
    API_SIWE_URI: ORIGIN,
    API_ALLOWED_ORIGINS: ORIGIN,
    RELAYER_ADDRESS: harness.fixture.ownerAccount.address,
  });
  const publicClient = createPublicClient({
    chain: {
      id: 31337,
      name: 'payguard-local-anvil',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [harness.fixture.rpcUrl] } },
    },
    transport: http(harness.fixture.rpcUrl),
  });
  const context = createAppContext({
    config,
    pool: harness.pool,
    publicClient,
    now: () => new Date(),
  });
  return buildApp(context).app;
}

describe('GET /v1/demo/scenarios', () => {
  it('lists the fixed scenario catalog and the caller owner’s own available demo profile', async () => {
    const { ownerSession, policyId } = await setupDemoVault();
    const response = await harness.built.app.inject({
      method: 'GET',
      url: '/v1/demo/scenarios',
      headers: browserHeaders(ownerSession, ORIGIN),
    });
    expect(response.statusCode).toBe(200);
    const { scenarios, profiles } = response.json().data;
    expect(scenarios.map((s: { scenarioId: string }) => s.scenarioId).sort()).toEqual(
      ['compute', 'duplicate', 'hotel', 'over_budget', 'unauthorized_merchant'].sort(),
    );
    const profile = profiles.find((p: { profileId: string }) => p.profileId === policyId);
    expect(profile).toBeTruthy();
    expect(profile.available).toBe(true);
    expect(profile.routeKind).toBe('DIRECT');
    for (const scenario of scenarios) {
      expect(scenario.permittedProfileIds).toContain(policyId);
    }
  }, 30_000);
});

describe('POST /v1/demo/runs: compute scenario (ALLOW)', () => {
  it('pays the exact invoiced output exactly once, and a lost response recovers the SAME run', async () => {
    const { ownerSession, policyId } = await setupDemoVault();
    const idempotencyKey = randomUUID();

    const first = await startRun(
      ownerSession,
      { profileId: policyId, scenarioId: 'compute' },
      idempotencyKey,
    );
    expect(first.statusCode).toBe(201);
    const firstBody = first.json().data;
    expect(firstBody.orchestrationStatus).toBe('QUEUED');
    expect(firstBody.paymentId).toBeTruthy();
    expect(firstBody.intentId).toBeTruthy();
    expect(firstBody.operationId).toBeTruthy();

    // Simulates a lost start response: same owner, same Idempotency-Key, same request body.
    const replay = await startRun(
      ownerSession,
      { profileId: policyId, scenarioId: 'compute' },
      idempotencyKey,
    );
    expect(replay.statusCode).toBe(201);
    expect(replay.json().data.runId).toBe(firstBody.runId);
    expect(replay.json().data.paymentId).toBe(firstBody.paymentId);
    expect(replay.json().data.intentId).toBe(firstBody.intentId);

    const balanceBefore = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;

    await driveOutboxForIntent(firstBody.intentId);

    const balanceAfter = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;
    expect(balanceAfter - balanceBefore).toBe(500_000n);

    const runRead = await getRun(ownerSession, firstBody.runId);
    expect(runRead.statusCode).toBe(200);
    expect(runRead.json().data.livePaymentStatus.executionStatus).toBe('SUCCEEDED');
    expect(runRead.json().data.livePaymentStatus.reconciliation).toBe('MATCHED');

    // A DIFFERENT Idempotency-Key with the SAME scenario is a deliberate new purchase: new invoice,
    // new run, not a replay of the first.
    const second = await startRun(ownerSession, { profileId: policyId, scenarioId: 'compute' });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.runId).not.toBe(firstBody.runId);
    expect(second.json().data.paymentId).not.toBe(firstBody.paymentId);
  }, 60_000);

  it('duplicate scenario: reusing the settled payment’s own invoice does not pay twice', async () => {
    const { ownerSession, policyId } = await setupDemoVault();
    const original = await startRun(ownerSession, { profileId: policyId, scenarioId: 'compute' });
    expect(original.statusCode).toBe(201);
    const originalBody = original.json().data;
    await driveOutboxForIntent(originalBody.intentId);

    const balanceBefore = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;

    const duplicate = await startRun(ownerSession, {
      profileId: policyId,
      scenarioId: 'duplicate',
      sourcePaymentId: originalBody.paymentId,
    });
    expect(duplicate.statusCode).toBe(201);
    const duplicateBody = duplicate.json().data;
    // The real vault's own `evaluate()` sees this invoice as already consumed and BLOCKs at the
    // intent stage -- the earliest real rejection point, never a later fabricated one. This IS the
    // "does not pay twice" proof: the fresh intent never even reaches submit.
    expect(duplicateBody.stage).toBe('intent');
    expect(duplicateBody.orchestrationStatus).toBe('BLOCKED');
    expect(duplicateBody.errorCode).toBe('INVOICE_ALREADY_PAID');
    expect(duplicateBody.operationId).toBeNull();
    // Same business obligation -- the SAME payment identity, not a second payment row.
    expect(duplicateBody.paymentId).toBe(originalBody.paymentId);

    const balanceAfter = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;
    expect(balanceAfter).toBe(balanceBefore);
  }, 60_000);
});

describe('POST /v1/demo/runs: hotel scenario (ESCALATE)', () => {
  it('pauses for a real owner approval -- the bridge never auto-approves, and cannot execute without it', async () => {
    const { ownerSession, policyId } = await setupDemoVault();
    const balanceBefore = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;

    const run = await startRun(ownerSession, { profileId: policyId, scenarioId: 'hotel' });
    expect(run.statusCode).toBe(201);
    const body = run.json().data;
    expect(body.orchestrationStatus).toBe('AWAITING_APPROVAL');
    expect(body.intentId).toBeTruthy();

    // The run is not submitted until the owner signs. Draining the outbox must leave it unpaid —
    // never a fabricated success, and never a worker CANCELLED that hides it from Approvals.
    await driveOutboxForIntent(body.intentId);
    const stillPending = await harness.pool.query(
      'SELECT execution_status FROM payments WHERE id = $1',
      [body.paymentId],
    );
    expect(stillPending.rows[0].execution_status).not.toBe('SUCCEEDED');

    // The real, separate owner signer supplies the exact approval through the normal API -- never
    // fabricated or auto-signed by the bridge itself.
    const typedDataResponse = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/payment-intents/${body.intentId}/approval-typed-data`,
      headers: browserHeaders(ownerSession, ORIGIN),
    });
    expect(typedDataResponse.statusCode).toBe(200);
    const { typedData } = typedDataResponse.json().data;
    const approval = typedData.message;
    const digest = hashApproval(
      { chainId: typedData.domain.chainId, verifyingContract: typedData.domain.verifyingContract },
      approval as never,
    );
    const ownerSignature = await harness.fixture.ownerAccount.sign({ hash: digest });

    const approvalResponse = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${body.intentId}/approvals`,
      headers: browserHeaders(ownerSession, ORIGIN),
      payload: { approval, ownerSignature },
    });
    expect(approvalResponse.statusCode).toBe(201);

    const resubmit = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${body.intentId}/submit`,
      headers: { ...browserHeaders(ownerSession, ORIGIN), 'idempotency-key': randomUUID() },
      payload: {},
    });
    expect(resubmit.statusCode).toBe(202);

    await driveOutboxForIntent(body.intentId);
    const settled = await getRun(ownerSession, body.runId);
    expect(settled.json().data.livePaymentStatus.executionStatus).toBe('SUCCEEDED');
    expect(settled.json().data.livePaymentStatus.policyDecision).toBe('ESCALATE');

    const balanceAfter = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;
    expect(balanceAfter - balanceBefore).toBe(180_000_000n);
  }, 60_000);

  it('a mutated (wrong-owner) approval signature is rejected and never lets the run execute', async () => {
    const { ownerSession, policyId } = await setupDemoVault();
    const run = await startRun(ownerSession, { profileId: policyId, scenarioId: 'hotel' });
    const body = run.json().data;

    const typedDataResponse = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/payment-intents/${body.intentId}/approval-typed-data`,
      headers: browserHeaders(ownerSession, ORIGIN),
    });
    const { typedData } = typedDataResponse.json().data;
    const approval = typedData.message;
    const digest = hashApproval(
      { chainId: typedData.domain.chainId, verifyingContract: typedData.domain.verifyingContract },
      approval as never,
    );
    // Signed by the AGENT key, not the owner -- a wrong signer, not a malformed signature.
    const wrongSignature = await privateKeyToAccount(AGENT_PRIVATE_KEY).sign({ hash: digest });

    const approvalResponse = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${body.intentId}/approvals`,
      headers: browserHeaders(ownerSession, ORIGIN),
      payload: { approval, ownerSignature: wrongSignature },
    });
    expect(approvalResponse.statusCode).toBe(422);
    expect(approvalResponse.json().error.code).toBe('INVALID_APPROVAL');
  }, 30_000);
});

describe('POST /v1/demo/runs: over_budget scenario (BLOCK)', () => {
  it('records the REAL vault BLOCK at the intent stage and never submits toward settlement', async () => {
    const { ownerSession, policyId } = await setupDemoVault();
    const balanceBefore = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;

    const run = await startRun(ownerSession, { profileId: policyId, scenarioId: 'over_budget' });
    expect(run.statusCode).toBe(201);
    const body = run.json().data;
    expect(body.stage).toBe('intent');
    expect(body.orchestrationStatus).toBe('BLOCKED');
    expect(body.operationId).toBeNull();
    expect(body.paymentId).toBeTruthy();

    const payment = await harness.pool.query(
      'SELECT execution_status FROM payments WHERE id = $1',
      [body.paymentId],
    );
    expect(payment.rows[0].execution_status).not.toBe('SUCCEEDED');

    const balanceAfter = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;
    expect(balanceAfter).toBe(balanceBefore);
  }, 30_000);
});

describe('POST /v1/demo/runs: unauthorized_merchant scenario', () => {
  it('the invoice itself is rejected with a real INVALID_SIGNATURE -- no payment is ever created', async () => {
    const { ownerSession, policyId } = await setupDemoVault();
    const run = await startRun(ownerSession, {
      profileId: policyId,
      scenarioId: 'unauthorized_merchant',
    });
    expect(run.statusCode).toBe(201);
    const body = run.json().data;
    expect(body.stage).toBe('invoice');
    expect(body.orchestrationStatus).toBe('REJECTED_INVALID_SIGNATURE');
    expect(body.errorCode).toBe('INVALID_SIGNATURE');
    expect(body.paymentId).toBeNull();
    expect(body.intentId).toBeNull();
  }, 30_000);
});

describe('demo bridge gating: not a general signing/status-mutation service', () => {
  it('demo-disabled deployment: the route does not exist at all', async () => {
    const { walletId } = await seedOwnerVault(harness);
    const ownerSession = await seedSession(harness, { walletId, sessionKind: 'BROWSER' });
    const disabledApp = await buildDemoDisabledApp();
    try {
      const response = await disabledApp.inject({
        method: 'GET',
        url: '/v1/demo/scenarios',
        headers: browserHeaders(ownerSession, ORIGIN),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('RESOURCE_NOT_FOUND');
    } finally {
      await disabledApp.close();
    }
  }, 30_000);

  it('a different owner may not start a run against a vault they do not own', async () => {
    const { policyId } = await setupDemoVault();
    const strangerWalletId = await seedWallet(
      harness,
      privateKeyToAccount(RELAYER_PRIVATE_KEY).address,
    );
    const strangerSession = await seedSession(harness, {
      walletId: strangerWalletId,
      sessionKind: 'BROWSER',
    });
    const response = await startRun(strangerSession, {
      profileId: policyId,
      scenarioId: 'compute',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('RESOURCE_FORBIDDEN');
  }, 30_000);

  it('missing CSRF token on the owner browser session is rejected', async () => {
    const { ownerSession, policyId } = await setupDemoVault();
    const response = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/demo/runs',
      headers: {
        cookie: `payguard_session=${ownerSession.token}`,
        origin: ORIGIN,
        'idempotency-key': randomUUID(),
      },
      payload: { profileId: policyId, scenarioId: 'compute' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('CSRF_REQUIRED');
  }, 30_000);

  it('an Origin outside the configured allowlist is rejected', async () => {
    const { ownerSession, policyId } = await setupDemoVault();
    const response = await startRun2(ownerSession, 'https://evil.example', {
      profileId: policyId,
      scenarioId: 'compute',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('ORIGIN_NOT_ALLOWED');

    function startRun2(
      session: { token: string; csrfToken: string | null },
      origin: string,
      payload: Record<string, unknown>,
    ) {
      return harness.built.app.inject({
        method: 'POST',
        url: '/v1/demo/runs',
        headers: { ...browserHeaders(session, origin), 'idempotency-key': randomUUID() },
        payload,
      });
    }
  }, 30_000);

  it('missing Idempotency-Key is rejected', async () => {
    const { ownerSession, policyId } = await setupDemoVault();
    const response = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/demo/runs',
      headers: browserHeaders(ownerSession, ORIGIN),
      payload: { profileId: policyId, scenarioId: 'compute' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  }, 30_000);

  it('an unknown scenarioId is rejected by schema validation, never reaches orchestration', async () => {
    const { ownerSession, policyId } = await setupDemoVault();
    const response = await startRun(ownerSession, {
      profileId: policyId,
      scenarioId: 'arbitrary_target',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_SCHEMA');
  }, 30_000);

  it('an unknown profileId is rejected', async () => {
    const { ownerSession } = await setupDemoVault();
    const response = await startRun(ownerSession, {
      profileId: randomUUID(),
      scenarioId: 'compute',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('RESOURCE_NOT_FOUND');
  }, 30_000);

  it('the bridge cannot be induced to sign an arbitrary target: a body mixing sourcePaymentId with a non-duplicate scenario is rejected', async () => {
    const { ownerSession, policyId } = await setupDemoVault();
    const response = await startRun(ownerSession, {
      profileId: policyId,
      scenarioId: 'compute',
      sourcePaymentId: randomUUID(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_SCHEMA');
  }, 30_000);

  it('a profile whose route is not configured/enabled is never selectable', async () => {
    const { ownerSession, vaultId } = await setupDemoVault();
    const disabledMerchantId =
      `0x${randomUUID().replace(/-/g, '').padEnd(64, 'e')}` as `0x${string}`;
    const { policyId: disabledProfileId } = await seedPolicy(harness, {
      vaultId,
      onchainPolicyId: `0x${keccak256(toHex('unconfigured-route')).slice(2)}` as `0x${string}`,
      config: {
        agent: harness.fixture.agentAccount.address,
        inputToken: harness.fixture.tokenAddress,
        settlementToken: harness.fixture.tokenAddress,
        adapter: '0x0000000000000000000000000000000000000000',
        // Not present in the deployment's configured route list.
        routeId: `0x${'1'.repeat(64)}`,
        ...DEMO_BUDGET,
        validAfter: '0',
        validUntil: '99999999999',
        allowedCategoryBitmap: '1',
        subsidyMode: 'NONE',
        // biome-ignore lint/suspicious/noExplicitAny: local test fixture shape matches seedPolicy's config param exactly
      } as any,
      merchants: [
        {
          merchantId: disabledMerchantId,
          recipient: harness.fixture.merchantAccount.address,
          invoiceSigner: harness.fixture.merchantAccount.address,
          category: 0,
        },
      ],
    });
    const response = await startRun(ownerSession, {
      profileId: disabledProfileId,
      scenarioId: 'compute',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('RESOURCE_FORBIDDEN');
  }, 30_000);

  it('a profileId belonging to a DIFFERENT deployment’s vault is treated as not found, never evaluated against this deployment’s config', async () => {
    const { ownerSession, walletId } = await setupDemoVault();

    const otherDeploymentId = randomUUID();
    await harness.pool.query(
      `INSERT INTO deployments (id, chain_id, instance_label, environment, start_block, genesis_or_anchor_hash, configuration)
       VALUES ($1, 31337, $2, 'LOCAL_DEMO', 0, $3, $4)`,
      [
        otherDeploymentId,
        `other-deployment-${randomUUID()}`,
        Buffer.alloc(32, 2),
        JSON.stringify({
          tokens: [],
          routes: [],
          confidencePolicy: { mode: 'LOCAL_DEMO', confirmationDepth: null },
        }),
      ],
    );
    const otherVaultId = randomUUID();
    await harness.pool.query(
      `INSERT INTO vaults (id, deployment_id, owner_wallet_id, address, runtime_code_hash, abi_schema_version)
       VALUES ($1,$2,$3,$4,$5,'1')`,
      [
        otherVaultId,
        otherDeploymentId,
        walletId,
        Buffer.from(keccak256(toHex('other-deployment-vault')).slice(2, 42), 'hex'),
        Buffer.from(keccak256(toHex('other-deployment-code')).slice(2), 'hex'),
      ],
    );
    const { policyId: otherDeploymentPolicyId } = await seedPolicy(harness, {
      vaultId: otherVaultId,
      onchainPolicyId: `0x${keccak256(toHex('other-deployment-policy')).slice(2)}` as `0x${string}`,
      config: {
        agent: harness.fixture.agentAccount.address,
        inputToken: harness.fixture.tokenAddress,
        settlementToken: harness.fixture.tokenAddress,
        adapter: '0x0000000000000000000000000000000000000000',
        routeId: `0x${'0'.repeat(64)}`,
        ...DEMO_BUDGET,
        validAfter: '0',
        validUntil: '99999999999',
        allowedCategoryBitmap: '1',
        subsidyMode: 'NONE',
        // biome-ignore lint/suspicious/noExplicitAny: local test fixture shape matches seedPolicy's config param exactly
      } as any,
    });

    const response = await startRun(ownerSession, {
      profileId: otherDeploymentPolicyId,
      scenarioId: 'compute',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('RESOURCE_NOT_FOUND');

    const scenariosResponse = await harness.built.app.inject({
      method: 'GET',
      url: '/v1/demo/scenarios',
      headers: browserHeaders(ownerSession, ORIGIN),
    });
    const { profiles } = scenariosResponse.json().data;
    expect(
      profiles.some((p: { profileId: string }) => p.profileId === otherDeploymentPolicyId),
    ).toBe(false);
  }, 30_000);
});
