/**
 * B4: "PayGuard public-API success" over the real Aqua/SwapVM route -- distinct from
 * `contracts/aqua/test/PayGuardAquaAdapter.t.sol`'s "bare protocol success" (both are required
 * per the B4 prompt, mirroring B3's own bare-protocol-vs-public-API split). Real HTTP
 * `app.inject()` end to end: SIWE login -> invoice -> intent -> submit -> the REAL Stage 5 worker
 * settling it via the REAL `PayGuardAquaAdapter` against the REAL local Aqua + AquaSwapVMRouter +
 * shipped maker strategy (`packages/test-utils/src/aquaVaultFixture.ts`) -> an authenticated GET
 * reading the receipt-backed result back. Direct-route and v4-route behavior are untouched by this
 * file (no source either exercises was modified) -- `publicApiPaymentDemo.test.ts` and
 * `v4Route.test.ts` remain their own regression proofs, rerun separately.
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
  type DeployedAquaVaultFixture,
  deployAquaVaultFixture,
  RELAYER_PRIVATE_KEY,
} from '@payguard/test-utils';
import { loadWorkerConfig } from '@payguard/worker/src/config.js';
import {
  createSubmitDeps,
  handlePaymentSubmissionJob,
} from '@payguard/worker/src/submitPayment.js';
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BuiltApp, buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createAppContext } from '../src/context.js';
import { ensureMigrated, getTestPool, truncateAll, uuid } from './helpers/testDb.js';
import { browserHeaders, seedSession } from './helpers/testApp.js';

let fixture: DeployedAquaVaultFixture;
let built: BuiltApp;
let pool: ReturnType<typeof getTestPool>;
let deploymentId: string;
let vaultId: string;
let walletId: string;
let policyId: string;
let onchainPolicyId: `0x${string}`;
const MERCHANT_ID = `0x${'b2'.repeat(32)}` as `0x${string}`;
const ORIGIN = 'http://127.0.0.1:3999';
let stopAnvilFn: (() => Promise<void>) | undefined;

beforeAll(async () => {
  const { spawnAnvil } = await import('@payguard/test-utils');
  const anvil = await spawnAnvil({ port: 8701, chainId: 31337 });
  stopAnvilFn = anvil.stop;
  fixture = await deployAquaVaultFixture({ rpcUrl: anvil.rpcUrl, chainId: 31337 });

  pool = getTestPool();
  await ensureMigrated(pool);
  await truncateAll(pool);

  deploymentId = uuid();
  await pool.query(
    `INSERT INTO deployments (id, chain_id, instance_label, environment, start_block, genesis_or_anchor_hash, configuration)
     VALUES ($1, 31337, $2, 'LOCAL_DEMO', 0, $3, $4)`,
    [
      deploymentId,
      `aqua-test-${randomUUID()}`,
      Buffer.alloc(32, 1),
      JSON.stringify({
        tokens: [
          { address: fixture.aqInputAddress, symbol: 'AQIN', decimals: 18, isMock: true },
          { address: fixture.aqOutputAddress, symbol: 'AQOUT', decimals: 18, isMock: true },
        ],
        routes: [
          {
            routeId: fixture.aquaRouteId,
            adapter: fixture.aquaAdapterAddress,
            kind: 'AQUA',
            inputToken: fixture.aqInputAddress,
            outputToken: fixture.aqOutputAddress,
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

  walletId = uuid();
  await pool.query('INSERT INTO wallets (id, address) VALUES ($1, $2)', [
    walletId,
    Buffer.from(fixture.ownerAccount.address.slice(2), 'hex'),
  ]);
  vaultId = uuid();
  const deployedCode = await fixture.publicClient.getCode({ address: fixture.vaultAddress });
  if (!deployedCode) throw new Error('no code observed at deployed aqua vault address');
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

  // Real on-chain policy: agent/merchant bound to the same fixture accounts, inputToken=aqInput,
  // settlementToken=aqOutput, adapter=the real deployed PayGuardAquaAdapter.
  const policyConfig = {
    agent: fixture.agentAccount.address,
    inputToken: fixture.aqInputAddress,
    settlementToken: fixture.aqOutputAddress,
    adapter: fixture.aquaAdapterAddress,
    routeId: fixture.aquaRouteId,
    totalOutputBudget: '300000000000000000000000',
    epochOutputBudget: '300000000000000000000000',
    automaticOutputCap: '100000000000000000000000',
    escalationOutputCap: '200000000000000000000000',
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

  // Owner deposit: real aqInput (input token) into the vault via the real deposit() path.
  const mintHash = await fixture.ownerWalletClient.writeContract({
    address: fixture.aqInputAddress,
    abi: fixture.erc20Abi,
    functionName: 'mint',
    args: [fixture.ownerAccount.address, 1_000_000000000000000000000n],
    chain: null,
    account: fixture.ownerAccount,
  } as never);
  await fixture.publicClient.waitForTransactionReceipt({ hash: mintHash });
  const approveHash = await fixture.ownerWalletClient.writeContract({
    address: fixture.aqInputAddress,
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
    args: [fixture.aqInputAddress, 1_000_000000000000000000000n],
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

describe('B4 public-API success: real HTTP -> SQL -> worker-relayed Aqua/SwapVM fill -> receipt -> authorized GET', () => {
  it('an agent pays a real invoice through the real Aqua route, the real worker settles it via the real shipped maker strategy, and the receipt-backed read matches', async () => {
    const agentAccessToken = await loginViaRealHttp(AGENT_PRIVATE_KEY);
    const agentAuthHeaders = { authorization: `Bearer ${agentAccessToken}` };

    const invoice: Invoice = {
      invoiceId: `0x${randomUUID().replace(/-/g, '').padEnd(64, '0')}` as `0x${string}`,
      merchantId: MERCHANT_ID,
      recipient: fixture.merchantAccount.address,
      settlementToken: fixture.aqOutputAddress,
      outputAmount: '1000000000000000000000', // 1000e18 output
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
      routeId: fixture.aquaRouteId,
      maxInputAmount: '5000000000000000000000', // generous aqInput ceiling
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
      address: fixture.aqOutputAddress,
      abi: fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [fixture.merchantAccount.address],
    })) as bigint;

    await driveOutboxToCompletion(jobId);

    const balanceAfter = (await fixture.publicClient.readContract({
      address: fixture.aqOutputAddress,
      abi: fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [fixture.merchantAccount.address],
    })) as bigint;
    // Real, exact settlement result -- never a hardcoded conversion number.
    expect(balanceAfter - balanceBefore).toBe(1_000_000000000000000000n);

    const getResponse = await built.app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}`,
      headers: agentAuthHeaders,
    });
    expect(getResponse.statusCode).toBe(200);
    const paymentBody = getResponse.json().data;
    expect(paymentBody.executionStatus).toBe('SUCCEEDED');
    expect(paymentBody.reconciliation).toBe('MATCHED');
    expect(paymentBody.settlement.outputDeliveredAtomic).toBe('1000000000000000000000');
    // The real decoded input actually spent (the XYCSwap-computed amount, never invented).
    expect(BigInt(paymentBody.settlement.actualInputAtomic)).toBeGreaterThan(0n);

    const onchainReceipt = await fixture.publicClient.getTransactionReceipt({
      hash: paymentBody.transaction.hash as `0x${string}`,
    });
    expect(onchainReceipt.status).toBe('success');
    expect(onchainReceipt.to?.toLowerCase()).toBe(fixture.vaultAddress.toLowerCase());
  }, 60_000);

  // B5: "do not infer two-route readiness from two isolated successful test files" -- ESCALATE
  // and a real on-chain-reverted fill, both through the actual API/worker/vault/DB path, not only
  // the bare-protocol ESCALATE/MaxInputExceeded cases already proven in PayGuardAquaAdapter.t.sol.
  it('an owner-approved ESCALATE settles over the real Aqua route through the real worker', async () => {
    const agentAccessToken = await loginViaRealHttp(AGENT_PRIVATE_KEY);
    const agentAuthHeaders = { authorization: `Bearer ${agentAccessToken}` };

    const invoice: Invoice = {
      invoiceId: `0x${randomUUID().replace(/-/g, '').padEnd(64, '0')}` as `0x${string}`,
      merchantId: MERCHANT_ID,
      recipient: fixture.merchantAccount.address,
      settlementToken: fixture.aqOutputAddress,
      outputAmount: '150000000000000000000000', // 150000e18 -- above the 100000e18 automatic cap, within the 200000e18 escalation cap
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
      routeId: fixture.aquaRouteId,
      // Within maxInputPerPayment (500000e18) and the remaining totalInputBudget headroom after
      // the earlier happy-path test's ~5000e18 spend -- a generous but authorized ceiling, not
      // the 5,000,000e18 over-budget value that previously triggered a false BLOCK here.
      maxInputAmount: '250000000000000000000000',
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
    expect(paymentBody.settlement.outputDeliveredAtomic).toBe('150000000000000000000000');
  }, 60_000);

  it('a real infeasible Aqua fill (max-input threshold exceeded) is rejected by real on-chain simulation before broadcast, never a fabricated success, and consumes no budget', async () => {
    const agentAccessToken = await loginViaRealHttp(AGENT_PRIVATE_KEY);
    const agentAuthHeaders = { authorization: `Bearer ${agentAccessToken}` };
    const merchantBalanceBefore = (await fixture.publicClient.readContract({
      address: fixture.aqOutputAddress,
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
      settlementToken: fixture.aqOutputAddress,
      outputAmount: '1000000000000000000000', // 1000e18, same size as the happy-path invoice
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
      routeId: fixture.aquaRouteId,
      // Deliberately far below the real fill's required input -- evaluate() cannot know the
      // actual on-chain XYCSwap cost, so this legitimately reaches submit. The real worker
      // (submitPayment.ts) then static-calls executePayment before ever broadcasting or
      // reserving a nonce; the real PayGuardAquaAdapter's own MaxInputExceededAtCallback check
      // reverts that call, so this never actually reaches the chain as a mined, reverted
      // transaction.
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
    // evaluate() checks policy/budget only, not real fill feasibility -- ALLOW is the honest
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
    // revert comes from the adapter's own MaxInputExceededAtCallback check, but the adapter's
    // custom errors are outside the vault's own generated ABI (decodeVaultRevert only recognizes
    // vault errors, packages/chain/src/errors.ts), so it surfaces honestly as the undecoded
    // fallback reason rather than a fabricated specific label.
    expect(paymentBody.executionStatus).toBe('CANCELLED');
    expect(paymentBody.reasonCode).toBe('SIMULATION_REJECTED');

    const merchantBalanceAfter = (await fixture.publicClient.readContract({
      address: fixture.aqOutputAddress,
      abi: fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [fixture.merchantAccount.address],
    })) as bigint;
    expect(merchantBalanceAfter).toBe(merchantBalanceBefore);

    const policyAfter = await built.app.inject({
      method: 'GET',
      url: `/v1/policies/${policyId}`,
      headers: agentAuthHeaders,
    });
    expect(policyAfter.json().data.counters.outputSpent).toBe(outputSpentBefore);
  }, 60_000);
});
