/**
 * B3: "PayGuard public-API success" over the real v4 route -- distinct from
 * `contracts/core-v4/test/PayGuardV4Adapter.t.sol`'s "bare protocol success" (both are required
 * per the B3 prompt). Real HTTP `app.inject()` end to end: SIWE login -> invoice -> intent ->
 * submit -> the REAL Stage 5 worker settling it via the REAL `PayGuardV4Adapter` against the REAL
 * local Uniswap v4 `PoolManager` (`packages/test-utils/src/v4VaultFixture.ts`) -> an authenticated
 * GET reading the receipt-backed result back. Direct-route behavior is untouched by this file
 * (no source it exercises was modified) -- `publicApiPaymentDemo.test.ts` remains its own
 * regression proof, rerun separately.
 */
import { randomUUID } from 'node:crypto';
import { createLocalPublicClient, PAYGUARD_VAULT_ABI, prepareCreatePolicy } from '@payguard/chain';
import { claimDueJobs, getOutboxById, type OutboxRow, retryJob } from '@payguard/db';
import {
  hashApproval,
  hashIntent,
  hashInvoice,
  type Invoice,
  type PaymentIntent,
} from '@payguard/domain';
import {
  AGENT_PRIVATE_KEY,
  type DeployedV4VaultFixture,
  deployV4VaultFixture,
  RELAYER_PRIVATE_KEY,
} from '@payguard/test-utils';
import { loadWorkerConfig } from '@payguard/worker/src/config.js';
import {
  createSubmitDeps,
  handlePaymentSubmissionJob,
} from '@payguard/worker/src/submitPayment.js';
import Ajv from 'ajv';
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BuiltApp, buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createAppContext } from '../src/context.js';
import { TIMELINE_PAGE_SCHEMA } from '../src/schemas.js';
import { browserHeaders, seedSession } from './helpers/testApp.js';
import { ensureMigrated, getTestPool, truncateAll, uuid } from './helpers/testDb.js';

const ajv = new Ajv({ strict: false });
const validateTimelinePage = ajv.compile(TIMELINE_PAGE_SCHEMA);

let fixture: DeployedV4VaultFixture;
let built: BuiltApp;
let pool: ReturnType<typeof getTestPool>;
let deploymentId: string;
let vaultId: string;
let walletId: string;
let policyId: string;
let onchainPolicyId: `0x${string}`;
const MERCHANT_ID = `0x${'a1'.repeat(32)}` as `0x${string}`;
const ORIGIN = 'http://127.0.0.1:3999';
let stopAnvilFn: (() => Promise<void>) | undefined;

beforeAll(async () => {
  const { spawnAnvil } = await import('@payguard/test-utils');
  const anvil = await spawnAnvil({ port: 8700, chainId: 31337 });
  stopAnvilFn = anvil.stop;
  fixture = await deployV4VaultFixture({ rpcUrl: anvil.rpcUrl, chainId: 31337 });

  pool = getTestPool();
  await ensureMigrated(pool);
  await truncateAll(pool);

  deploymentId = uuid();
  await pool.query(
    `INSERT INTO deployments (id, chain_id, instance_label, environment, start_block, genesis_or_anchor_hash, configuration)
     VALUES ($1, 31337, $2, 'LOCAL_DEMO', 0, $3, $4)`,
    [
      deploymentId,
      `v4-test-${randomUUID()}`,
      Buffer.alloc(32, 1),
      JSON.stringify({
        tokens: [
          { address: fixture.usdcAddress, symbol: 'mUSDC', decimals: 6, isMock: true },
          { address: fixture.rwaAddress, symbol: 'mRWA', decimals: 18, isMock: true },
        ],
        routes: [
          {
            routeId: fixture.v4RouteId,
            adapter: fixture.v4AdapterAddress,
            kind: 'V4',
            inputToken: fixture.rwaAddress,
            outputToken: fixture.usdcAddress,
            subsidyModes: ['NONE'],
            enabled: true,
          },
        ],
        confidencePolicy: { mode: 'LOCAL_DEMO', confirmationDepth: null },
      }),
    ],
  );

  const config = loadConfig({
    DATABASE_URL: 'unused-direct-pool',
    PAYGUARD_DEPLOYMENT_ID: deploymentId,
    CHAIN_ID: '31337',
    RPC_URL: fixture.rpcUrl,
    API_SIWE_DOMAIN: '127.0.0.1:3999',
    API_SIWE_URI: 'http://127.0.0.1:3999',
    API_ALLOWED_ORIGINS: 'http://127.0.0.1:3999',
    RELAYER_ADDRESS: fixture.ownerAccount.address,
  });
  const publicClient = createPublicClient({
    chain: {
      id: 31337,
      name: 'payguard-local-anvil',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [fixture.rpcUrl] } },
    },
    transport: http(fixture.rpcUrl),
  });
  const context = createAppContext({ config, pool, publicClient, now: () => new Date() });
  built = buildApp(context);

  // Wallet/vault rows (mirrors seedOwnerVault's own real-code-hash pattern).
  walletId = uuid();
  await pool.query('INSERT INTO wallets (id, address) VALUES ($1, $2)', [
    walletId,
    Buffer.from(fixture.ownerAccount.address.slice(2), 'hex'),
  ]);
  vaultId = uuid();
  const deployedCode = await fixture.publicClient.getCode({ address: fixture.vaultAddress });
  if (!deployedCode) throw new Error('no code observed at deployed v4 vault address');
  const { keccak256 } = await import('viem');
  await pool.query(
    `INSERT INTO vaults (id, deployment_id, owner_wallet_id, address, runtime_code_hash, abi_schema_version)
     VALUES ($1,$2,$3,$4,$5,'1')`,
    [
      vaultId,
      deploymentId,
      walletId,
      Buffer.from(fixture.vaultAddress.slice(2), 'hex'),
      Buffer.from(keccak256(deployedCode).slice(2), 'hex'),
    ],
  );

  // Real on-chain policy: agent/merchant bound to the same fixture accounts, inputToken=mRWA,
  // settlementToken=mUSDC, adapter=the real deployed PayGuardV4Adapter.
  const policyConfig = {
    agent: fixture.agentAccount.address,
    inputToken: fixture.rwaAddress,
    settlementToken: fixture.usdcAddress,
    adapter: fixture.v4AdapterAddress,
    routeId: fixture.v4RouteId,
    totalOutputBudget: '300000000',
    epochOutputBudget: '300000000',
    automaticOutputCap: '100000000',
    escalationOutputCap: '200000000',
    totalInputBudget: '1000000000000000000000000',
    maxInputPerPayment: '500000000000000000000000',
    validAfter: '0',
    validUntil: '99999999999',
    allowedCategoryBitmap: '1',
    subsidyMode: 'NONE' as const,
  };
  const prepared = prepareCreatePolicy(
    {
      chainId: '31337',
      ownerAddress: fixture.ownerAccount.address,
      vaultAddress: fixture.vaultAddress,
    },
    // biome-ignore lint/suspicious/noExplicitAny: fixture shape matches PolicyConfig exactly
    policyConfig as any,
    [
      {
        merchantId: MERCHANT_ID,
        recipient: fixture.merchantAccount.address,
        invoiceSigner: fixture.merchantAccount.address,
        category: '0',
      },
    ] as never,
  );
  const createPolicyHash = await fixture.ownerWalletClient.sendTransaction({
    to: prepared.transaction.to as `0x${string}`,
    data: prepared.transaction.data as `0x${string}`,
    value: 0n,
    chain: null,
    account: fixture.ownerAccount,
  });
  const receipt = await fixture.publicClient.waitForTransactionReceipt({ hash: createPolicyHash });
  const { decodeEventLog } = await import('viem');
  let foundPolicyId: `0x${string}` | null = null;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: fixture.vaultAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === 'PolicyCreated') {
        foundPolicyId = (decoded.args as { policyId: `0x${string}` }).policyId;
      }
    } catch {
      // not this event
    }
  }
  if (!foundPolicyId) throw new Error('PolicyCreated event not found');
  onchainPolicyId = foundPolicyId;

  policyId = uuid();
  await pool.query(
    `INSERT INTO policies (
       id, vault_id, onchain_policy_id, agent, input_token, settlement_token, adapter, route_id,
       total_output_budget, epoch_output_budget, automatic_output_cap, escalation_output_cap,
       total_input_budget, max_input_per_payment, valid_after, valid_until, subsidy_mode,
       canonical_config_bytes, config_projection, observed_status, observed_block_hash
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'ACTIVE',$20)`,
    [
      policyId,
      vaultId,
      Buffer.from(onchainPolicyId.slice(2), 'hex'),
      Buffer.from(policyConfig.agent.slice(2), 'hex'),
      Buffer.from(policyConfig.inputToken.slice(2), 'hex'),
      Buffer.from(policyConfig.settlementToken.slice(2), 'hex'),
      Buffer.from(policyConfig.adapter.slice(2), 'hex'),
      Buffer.from(policyConfig.routeId.slice(2), 'hex'),
      policyConfig.totalOutputBudget,
      policyConfig.epochOutputBudget,
      policyConfig.automaticOutputCap,
      policyConfig.escalationOutputCap,
      policyConfig.totalInputBudget,
      policyConfig.maxInputPerPayment,
      policyConfig.validAfter,
      policyConfig.validUntil,
      0,
      Buffer.alloc(32),
      JSON.stringify(policyConfig),
      Buffer.alloc(32),
    ],
  );
  await pool.query(
    `INSERT INTO policy_merchants (policy_id, merchant_id, recipient, invoice_signer, category)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      policyId,
      Buffer.from(MERCHANT_ID.slice(2), 'hex'),
      Buffer.from(fixture.merchantAccount.address.slice(2), 'hex'),
      Buffer.from(fixture.merchantAccount.address.slice(2), 'hex'),
      0,
    ],
  );

  // Owner deposit: real mRWA (input token) into the vault via the real deposit() path.
  const mintHash = await fixture.ownerWalletClient.writeContract({
    address: fixture.rwaAddress,
    abi: fixture.erc20Abi,
    functionName: 'mint',
    args: [fixture.ownerAccount.address, 1_000_000000000000000000000n],
    chain: null,
    account: fixture.ownerAccount,
  } as never);
  await fixture.publicClient.waitForTransactionReceipt({ hash: mintHash });
  const approveHash = await fixture.ownerWalletClient.writeContract({
    address: fixture.rwaAddress,
    abi: fixture.erc20Abi,
    functionName: 'approve',
    args: [fixture.vaultAddress, 1_000_000000000000000000000n],
    chain: null,
    account: fixture.ownerAccount,
  } as never);
  await fixture.publicClient.waitForTransactionReceipt({ hash: approveHash });
  const depositHash = await fixture.ownerWalletClient.writeContract({
    address: fixture.vaultAddress,
    abi: PAYGUARD_VAULT_ABI,
    functionName: 'deposit',
    args: [fixture.rwaAddress, 1_000_000000000000000000000n],
    chain: null,
    account: fixture.ownerAccount,
  } as never);
  await fixture.publicClient.waitForTransactionReceipt({ hash: depositHash });
}, 120_000);

afterAll(async () => {
  await built.app.close();
  if (stopAnvilFn) await stopAnvilFn();
}, 30_000);

async function loginViaRealHttp(privateKey: `0x${string}`): Promise<string> {
  const account = privateKeyToAccount(privateKey);
  const challengeResponse = await built.app.inject({
    method: 'POST',
    url: '/v1/auth/challenges',
    payload: { address: account.address, chainId: '31337', sessionKind: 'AGENT' },
  });
  expect(challengeResponse.statusCode).toBe(201);
  const { data: challenge } = challengeResponse.json();
  const signature = await account.signMessage({ message: challenge.message });
  const verifyResponse = await built.app.inject({
    method: 'POST',
    url: '/v1/auth/verify',
    payload: { challengeId: challenge.challengeId, signature },
  });
  expect(verifyResponse.statusCode).toBe(201);
  return verifyResponse.json().data.accessToken;
}

async function driveOutboxToCompletion(jobId: string): Promise<void> {
  const workerConfig = loadWorkerConfig({
    DATABASE_URL: 'unused',
    RPC_URL: fixture.rpcUrl,
    CHAIN_ID: '31337',
    PAYGUARD_DEPLOYMENT_ID: deploymentId,
    RELAYER_PRIVATE_KEY,
    WORKER_RECEIPT_POLL_ATTEMPTS: '10',
    WORKER_RECEIPT_POLL_INTERVAL_MS: '200',
  });
  const publicClient = createLocalPublicClient({ rpcUrl: fixture.rpcUrl, chainId: 31337 });
  const submitDeps = createSubmitDeps({ pool, publicClient, config: workerConfig });

  for (let i = 0; i < 60; i++) {
    const [job] = await claimDueJobs(pool, {
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
          await retryJob(pool, {
            id: job.id,
            leaseOwner: job.leaseOwner!,
            expectedLeaseVersion: job.leaseVersion,
            error: result.reason,
            maxAttempts: 20,
            backoffSeconds: 1,
          });
        }
      } catch (error) {
        await retryJob(pool, {
          id: job.id,
          leaseOwner: job.leaseOwner!,
          expectedLeaseVersion: job.leaseVersion,
          error: error instanceof Error ? error.message : String(error),
          maxAttempts: 20,
          backoffSeconds: 1,
        });
      }
    }
    const current: OutboxRow | null = await getOutboxById(pool, jobId);
    if (current && (current.status === 'DONE' || current.status === 'DEAD')) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

describe('B3 public-API success: real HTTP -> SQL -> worker-relayed v4 swap -> receipt -> authorized GET', () => {
  it('an agent pays a real invoice through the real v4 route, the real worker settles it via the real PoolManager, and the receipt-backed read matches', async () => {
    const agentAccessToken = await loginViaRealHttp(AGENT_PRIVATE_KEY);
    const agentAuthHeaders = { authorization: `Bearer ${agentAccessToken}` };

    const invoice: Invoice = {
      invoiceId: `0x${randomUUID().replace(/-/g, '').padEnd(64, '0')}` as `0x${string}`,
      merchantId: MERCHANT_ID,
      recipient: fixture.merchantAccount.address,
      settlementToken: fixture.usdcAddress,
      outputAmount: '500000', // 0.50 mUSDC
      category: '0',
      validUntil: '99999999999',
    };
    const eip712Domain = { chainId: 31337, verifyingContract: fixture.vaultAddress };
    const invoiceDigest = hashInvoice(eip712Domain, invoice);
    const merchantSignature = await fixture.merchantAccount.sign({ hash: invoiceDigest });

    const invoiceResponse = await built.app.inject({
      method: 'POST',
      url: '/v1/invoices',
      headers: agentAuthHeaders,
      payload: { vaultId, invoice, merchantSignature },
    });
    expect(invoiceResponse.statusCode).toBe(201);
    const { invoiceResourceId } = invoiceResponse.json().data;

    const intent: PaymentIntent = {
      policyId: onchainPolicyId,
      invoiceHash: invoiceDigest,
      routeId: fixture.v4RouteId,
      maxInputAmount: '50000000000000000000000', // generous mRWA ceiling
      nonce: Math.floor(Math.random() * 1e9).toString(10),
      validUntil: '99999999999',
      subsidyMode: 'NONE',
      maxSubsidyAmount: '0',
    };
    const intentDigest = hashIntent(eip712Domain, intent);
    const agentSignature = await fixture.agentAccount.sign({ hash: intentDigest });

    const intentResponse = await built.app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: { ...agentAuthHeaders, 'idempotency-key': randomUUID() },
      payload: { invoiceResourceId, policyResourceId: policyId, intent, agentSignature },
    });
    expect(intentResponse.statusCode).toBe(201);
    const { paymentId, intentId, evaluation } = intentResponse.json().data;
    expect(evaluation.decision).toBe('ALLOW');

    const submitResponse = await built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      headers: { ...agentAuthHeaders, 'idempotency-key': randomUUID() },
      payload: {},
    });
    expect(submitResponse.statusCode).toBe(202);

    const jobRow = await pool.query(
      "SELECT id FROM outbox WHERE aggregate_id = $1 AND event_type = 'PAYMENT_SUBMISSION_REQUESTED' ORDER BY created_at DESC LIMIT 1",
      [intentId],
    );
    const jobId = jobRow.rows[0].id as string;

    const balanceBefore = (await fixture.publicClient.readContract({
      address: fixture.usdcAddress,
      abi: fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [fixture.merchantAccount.address],
    })) as bigint;

    await driveOutboxToCompletion(jobId);

    const balanceAfter = (await fixture.publicClient.readContract({
      address: fixture.usdcAddress,
      abi: fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [fixture.merchantAccount.address],
    })) as bigint;
    // Real, exact settlement result -- never a hardcoded conversion number.
    expect(balanceAfter - balanceBefore).toBe(500_000n);

    const getResponse = await built.app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}`,
      headers: agentAuthHeaders,
    });
    expect(getResponse.statusCode).toBe(200);
    const paymentBody = getResponse.json().data;
    expect(paymentBody.executionStatus).toBe('SUCCEEDED');
    expect(paymentBody.reconciliation).toBe('MATCHED');
    expect(paymentBody.settlement.outputDeliveredAtomic).toBe('500000');
    // The real decoded input actually spent -- some positive amount of mRWA, never invented.
    expect(BigInt(paymentBody.settlement.actualInputAtomic)).toBeGreaterThan(0n);

    const onchainReceipt = await fixture.publicClient.getTransactionReceipt({
      hash: paymentBody.transaction.hash as `0x${string}`,
    });
    expect(onchainReceipt.status).toBe('success');
    expect(onchainReceipt.to?.toLowerCase()).toBe(fixture.vaultAddress.toLowerCase());

    // B5: GET /v1/payments/{id}/timeline had zero functional test coverage anywhere in the repo
    // before this -- registered and openapi-drift-checked, but never actually called and asserted
    // against real worker-written rows. A real settled payment always has at least one real event
    // (submitPayment.ts/reconcile.ts insert on the real success path).
    const timelineResponse = await built.app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}/timeline`,
      headers: agentAuthHeaders,
    });
    expect(timelineResponse.statusCode).toBe(200);
    const timelineBody = timelineResponse.json().data;
    expect(validateTimelinePage(timelineBody)).toBe(true);
    expect(timelineBody.items.length).toBeGreaterThan(0);
    expect(timelineBody.items.every((item: { createdAt: string }) => item.createdAt)).toBe(true);
  }, 60_000);

  // B5: "do not infer two-route readiness from two isolated successful test files" -- ESCALATE
  // and a real on-chain-reverted swap, both through the actual API/worker/vault/DB path, not only
  // the bare-protocol ESCALATE/MaxInputExceeded cases already proven in PayGuardV4Adapter.t.sol.
  it('an owner-approved ESCALATE settles over the real v4 route through the real worker', async () => {
    const agentAccessToken = await loginViaRealHttp(AGENT_PRIVATE_KEY);
    const agentAuthHeaders = { authorization: `Bearer ${agentAccessToken}` };

    const invoice: Invoice = {
      invoiceId: `0x${randomUUID().replace(/-/g, '').padEnd(64, '0')}` as `0x${string}`,
      merchantId: MERCHANT_ID,
      recipient: fixture.merchantAccount.address,
      settlementToken: fixture.usdcAddress,
      outputAmount: '150000000', // 150 mUSDC -- above the 100 automatic cap, within the 200 escalation cap
      category: '0',
      validUntil: '99999999999',
    };
    const eip712Domain = { chainId: 31337, verifyingContract: fixture.vaultAddress };
    const invoiceDigest = hashInvoice(eip712Domain, invoice);
    const merchantSignature = await fixture.merchantAccount.sign({ hash: invoiceDigest });

    const invoiceResponse = await built.app.inject({
      method: 'POST',
      url: '/v1/invoices',
      headers: agentAuthHeaders,
      payload: { vaultId, invoice, merchantSignature },
    });
    expect(invoiceResponse.statusCode).toBe(201);
    const { invoiceResourceId } = invoiceResponse.json().data;

    const intent: PaymentIntent = {
      policyId: onchainPolicyId,
      invoiceHash: invoiceDigest,
      routeId: fixture.v4RouteId,
      maxInputAmount: '50000000000000000000000',
      nonce: Math.floor(Math.random() * 1e9).toString(10),
      validUntil: '99999999999',
      subsidyMode: 'NONE',
      maxSubsidyAmount: '0',
    };
    const intentDigest = hashIntent(eip712Domain, intent);
    const agentSignature = await fixture.agentAccount.sign({ hash: intentDigest });

    const intentResponse = await built.app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: { ...agentAuthHeaders, 'idempotency-key': randomUUID() },
      payload: { invoiceResourceId, policyResourceId: policyId, intent, agentSignature },
    });
    expect(intentResponse.statusCode).toBe(201);
    const { paymentId, intentId, evaluation } = intentResponse.json().data;
    expect(evaluation.decision).toBe('ESCALATE');

    // Real owner-side approval, never fabricated by the test itself -- a real owner BROWSER
    // session (cookie + CSRF + Origin), signing exactly the server-provided typed data, mirroring
    // the demo bridge's own hotel-scenario flow (test/demo.test.ts). The agent's bearer token
    // cannot authorize this: `isOwner` is derived from the session's wallet, not its auth kind.
    const ownerSession = await seedSession({ pool }, { walletId, sessionKind: 'BROWSER' });
    const typedDataResponse = await built.app.inject({
      method: 'GET',
      url: `/v1/payment-intents/${intentId}/approval-typed-data`,
      headers: browserHeaders(ownerSession, ORIGIN),
    });
    expect(typedDataResponse.statusCode).toBe(200);
    const { typedData } = typedDataResponse.json().data;
    const approvalDigest = hashApproval(
      { chainId: typedData.domain.chainId, verifyingContract: typedData.domain.verifyingContract },
      typedData.message as never,
    );
    const ownerSignature = await fixture.ownerAccount.sign({ hash: approvalDigest });
    const approvalResponse = await built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/approvals`,
      headers: browserHeaders(ownerSession, ORIGIN),
      payload: { approval: typedData.message, ownerSignature },
    });
    expect(approvalResponse.statusCode).toBe(201);

    const submitResponse = await built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      headers: { ...agentAuthHeaders, 'idempotency-key': randomUUID() },
      payload: {},
    });
    expect(submitResponse.statusCode).toBe(202);

    const jobRow = await pool.query(
      "SELECT id FROM outbox WHERE aggregate_id = $1 AND event_type = 'PAYMENT_SUBMISSION_REQUESTED' ORDER BY created_at DESC LIMIT 1",
      [intentId],
    );
    await driveOutboxToCompletion(jobRow.rows[0].id as string);

    const getResponse = await built.app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}`,
      headers: agentAuthHeaders,
    });
    expect(getResponse.statusCode).toBe(200);
    const paymentBody = getResponse.json().data;
    expect(paymentBody.executionStatus).toBe('SUCCEEDED');
    expect(paymentBody.settlement.outputDeliveredAtomic).toBe('150000000');
  }, 60_000);

  it('a real infeasible v4 swap (max-input threshold exceeded) is rejected by real on-chain simulation before broadcast, never a fabricated success, and consumes no budget', async () => {
    const agentAccessToken = await loginViaRealHttp(AGENT_PRIVATE_KEY);
    const agentAuthHeaders = { authorization: `Bearer ${agentAccessToken}` };
    const merchantBalanceBefore = (await fixture.publicClient.readContract({
      address: fixture.usdcAddress,
      abi: fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [fixture.merchantAccount.address],
    })) as bigint;
    const policyBefore = await built.app.inject({
      method: 'GET',
      url: `/v1/policies/${policyId}`,
      headers: agentAuthHeaders,
    });
    const outputSpentBefore = policyBefore.json().data.counters.outputSpent as string;

    const invoice: Invoice = {
      invoiceId: `0x${randomUUID().replace(/-/g, '').padEnd(64, '0')}` as `0x${string}`,
      merchantId: MERCHANT_ID,
      recipient: fixture.merchantAccount.address,
      settlementToken: fixture.usdcAddress,
      outputAmount: '500000', // 0.50 mUSDC
      category: '0',
      validUntil: '99999999999',
    };
    const eip712Domain = { chainId: 31337, verifyingContract: fixture.vaultAddress };
    const invoiceDigest = hashInvoice(eip712Domain, invoice);
    const merchantSignature = await fixture.merchantAccount.sign({ hash: invoiceDigest });

    const invoiceResponse = await built.app.inject({
      method: 'POST',
      url: '/v1/invoices',
      headers: agentAuthHeaders,
      payload: { vaultId, invoice, merchantSignature },
    });
    expect(invoiceResponse.statusCode).toBe(201);
    const { invoiceResourceId } = invoiceResponse.json().data;

    const intent: PaymentIntent = {
      policyId: onchainPolicyId,
      invoiceHash: invoiceDigest,
      routeId: fixture.v4RouteId,
      // Deliberately far below the real swap's required input -- evaluate() cannot know the
      // actual on-chain swap cost, so this legitimately reaches submit. The real worker
      // (submitPayment.ts) then static-calls executePayment before ever broadcasting or
      // reserving a nonce; the real PayGuardV4Adapter's own MaxInputExceeded check reverts
      // that call, so this never actually reaches the chain as a mined, reverted transaction.
      maxInputAmount: '1',
      nonce: Math.floor(Math.random() * 1e9).toString(10),
      validUntil: '99999999999',
      subsidyMode: 'NONE',
      maxSubsidyAmount: '0',
    };
    const intentDigest = hashIntent(eip712Domain, intent);
    const agentSignature = await fixture.agentAccount.sign({ hash: intentDigest });

    const intentResponse = await built.app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: { ...agentAuthHeaders, 'idempotency-key': randomUUID() },
      payload: { invoiceResourceId, policyResourceId: policyId, intent, agentSignature },
    });
    expect(intentResponse.statusCode).toBe(201);
    const { paymentId, intentId, evaluation } = intentResponse.json().data;
    // evaluate() checks policy/budget only, not real swap feasibility -- ALLOW is the honest
    // pre-execution decision; the real failure surfaces at settlement, not here.
    expect(evaluation.decision).toBe('ALLOW');

    const submitResponse = await built.app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      headers: { ...agentAuthHeaders, 'idempotency-key': randomUUID() },
      payload: {},
    });
    expect(submitResponse.statusCode).toBe(202);

    const jobRow = await pool.query(
      "SELECT id FROM outbox WHERE aggregate_id = $1 AND event_type = 'PAYMENT_SUBMISSION_REQUESTED' ORDER BY created_at DESC LIMIT 1",
      [intentId],
    );
    await driveOutboxToCompletion(jobRow.rows[0].id as string);

    const getResponse = await built.app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}`,
      headers: agentAuthHeaders,
    });
    expect(getResponse.statusCode).toBe(200);
    const paymentBody = getResponse.json().data;
    // Real on-chain simulation rejection -- never reported as SUCCEEDED, never a fabricated
    // partial-success, and no gas was ever spent broadcasting a doomed transaction. The real
    // revert comes from the adapter's own MaxInputExceeded check, but the adapter's custom
    // errors are outside the vault's own generated ABI (decodeVaultRevert only recognizes vault
    // errors, packages/chain/src/errors.ts), so it surfaces honestly as the undecoded fallback
    // reason rather than a fabricated specific label.
    expect(paymentBody.executionStatus).toBe('CANCELLED');
    expect(paymentBody.reasonCode).toBe('SIMULATION_REJECTED');

    const merchantBalanceAfter = (await fixture.publicClient.readContract({
      address: fixture.usdcAddress,
      abi: fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [fixture.merchantAccount.address],
    })) as bigint;
    // No output-side leakage from this reverted attempt -- the merchant's balance is byte-for-byte
    // unchanged by this specific test, regardless of what earlier tests in this file already paid.
    expect(merchantBalanceAfter).toBe(merchantBalanceBefore);

    const policyAfter = await built.app.inject({
      method: 'GET',
      url: `/v1/policies/${policyId}`,
      headers: agentAuthHeaders,
    });
    expect(policyAfter.json().data.counters.outputSpent).toBe(outputSpentBefore);
  }, 60_000);
});
