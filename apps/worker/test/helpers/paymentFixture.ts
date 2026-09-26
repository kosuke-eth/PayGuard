/**
 * Real end-to-end worker test fixture: real local Anvil, a REAL deployed PayGuardVault +
 * MockERC20, a real Postgres `payguard_test` database, real on-chain policy creation and owner
 * deposit, and real EIP-712 signing for invoice/intent -- built via direct `@payguard/db`
 * repository calls (mirroring exactly what `apps/api`'s routes do internally) rather than driving
 * an HTTP server, since the worker package has no reason to depend on `apps/api`.
 */
import { randomBytes } from 'node:crypto';
import { PAYGUARD_VAULT_ABI, prepareCreatePolicy } from '@payguard/chain';
import {
  createApproval,
  createDeployment,
  createIntentVersion,
  createOperation,
  createOrGetInvoice,
  createPaymentForInvoice,
  createSignedArtifact,
  createVault,
  enqueue,
  findOrCreateWallet,
  getPaymentById,
  insertPolicyMerchants,
  isExecutionStatusTransitionAllowed,
  recordObservedPolicy,
  updatePaymentState,
  withTransaction,
} from '@payguard/db';
import {
  approvalNonceFromIntentHash,
  domainFor,
  EIP712_TYPES,
  type ExceptionApproval,
  hashApproval,
  hashIntent,
  hashInvoice,
  type Invoice,
  type PaymentIntent,
} from '@payguard/domain';
import {
  type DeployedVaultFixture,
  deployVaultFixture,
  mintTokens,
  spawnAnvil,
} from '@payguard/test-utils';
import type pg from 'pg';
import { decodeEventLog, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ensureMigrated, getTestPool, truncateAll, uuid } from './testDb.js';

export interface WorkerHarness {
  pool: pg.Pool;
  fixture: DeployedVaultFixture;
  deploymentId: string;
  chainId: number;
  stopAnvil: () => Promise<void>;
}

let nextPort = 8700;

export async function createWorkerHarness(): Promise<WorkerHarness> {
  const pool = getTestPool();
  await ensureMigrated(pool);
  await truncateAll(pool);

  const port = nextPort++;
  const anvil = await spawnAnvil({ port, chainId: 31337 });
  const fixture = await deployVaultFixture({ rpcUrl: anvil.rpcUrl, chainId: 31337 });

  const deploymentId = uuid();
  await withTransaction(pool, (client) =>
    createDeployment(client, {
      id: deploymentId,
      chainId: 31337n,
      instanceLabel: `worker-test-${uuid()}`,
      environment: 'LOCAL_DEMO',
      startBlock: 0n,
      genesisOrAnchorHash: Buffer.alloc(32, 1),
      configuration: { confidencePolicy: { mode: 'LOCAL_DEMO', confirmationDepth: null } },
    }),
  );

  return {
    pool,
    fixture,
    deploymentId,
    chainId: 31337,
    stopAnvil: async () => {
      await anvil.stop();
    },
  };
}

/**
 * Idempotent: multiple tests in one file share ONE deployed vault contract (via `beforeAll`), so
 * a second call for the same (deployment, address) must return the existing row, not collide on
 * the unique constraint.
 */
export async function seedOwnerVault(
  harness: WorkerHarness,
): Promise<{ vaultId: string; ownerWalletId: string }> {
  return withTransaction(harness.pool, async (client) => {
    const owner = await findOrCreateWallet(client, {
      id: uuid(),
      address: Buffer.from(harness.fixture.ownerAccount.address.slice(2), 'hex'),
    });
    const addressBytes = Buffer.from(harness.fixture.vaultAddress.slice(2), 'hex');
    const existing = await client.query(
      'SELECT id FROM vaults WHERE deployment_id = $1 AND address = $2',
      [harness.deploymentId, addressBytes],
    );
    if (existing.rows[0]) {
      return { vaultId: existing.rows[0].id as string, ownerWalletId: owner.id };
    }
    // B1 (INT-006): record the vault's REAL deployed code hash, not a placeholder -- health.ts's
    // `vaultCode` readiness check compares live `getCode` against exactly this stored value.
    const deployedCode = await harness.fixture.publicClient.getCode({
      address: harness.fixture.vaultAddress,
    });
    if (!deployedCode) throw new Error('seedOwnerVault: no code observed at vault address');
    const vault = await createVault(client, {
      id: uuid(),
      deploymentId: harness.deploymentId,
      ownerWalletId: owner.id,
      address: addressBytes,
      runtimeCodeHash: Buffer.from(keccak256(deployedCode).slice(2), 'hex'),
      abiSchemaVersion: '1',
    });
    return { vaultId: vault.id, ownerWalletId: owner.id };
  });
}

export function directRouteConfig(harness: WorkerHarness) {
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

export async function deployRealPolicy(
  harness: WorkerHarness,
  config: ReturnType<typeof directRouteConfig>,
  merchants: Array<{
    merchantId: `0x${string}`;
    recipient: `0x${string}`;
    invoiceSigner: `0x${string}`;
    category: number;
  }>,
): Promise<`0x${string}`> {
  const prepared = prepareCreatePolicy(
    {
      chainId: harness.chainId.toString(10),
      ownerAddress: harness.fixture.ownerAccount.address,
      vaultAddress: harness.fixture.vaultAddress,
    },
    // biome-ignore lint/suspicious/noExplicitAny: fixture shape matches PolicyConfig exactly
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

export async function seedPolicyRow(
  harness: WorkerHarness,
  params: {
    vaultId: string;
    onchainPolicyId: `0x${string}`;
    config: ReturnType<typeof directRouteConfig>;
    merchants: Array<{
      merchantId: `0x${string}`;
      recipient: `0x${string}`;
      invoiceSigner: `0x${string}`;
      category: number;
    }>;
  },
): Promise<{ policyId: string }> {
  const subsidyOnchain = { NONE: 0, REQUIRED: 1, BEST_EFFORT: 2 }[params.config.subsidyMode];
  const addr = (a: string) => Buffer.from(a.slice(2), 'hex');
  const { policyId } = await withTransaction(harness.pool, async (client) => {
    const result = await recordObservedPolicy(client, {
      id: uuid(),
      vaultId: params.vaultId,
      onchainPolicyId: Buffer.from(params.onchainPolicyId.slice(2), 'hex'),
      agent: addr(params.config.agent),
      inputToken: addr(params.config.inputToken),
      settlementToken: addr(params.config.settlementToken),
      adapter: addr(params.config.adapter),
      routeId: Buffer.from(params.config.routeId.slice(2), 'hex'),
      totalOutputBudget: BigInt(params.config.totalOutputBudget),
      epochOutputBudget: BigInt(params.config.epochOutputBudget),
      automaticOutputCap: BigInt(params.config.automaticOutputCap),
      escalationOutputCap: BigInt(params.config.escalationOutputCap),
      totalInputBudget: BigInt(params.config.totalInputBudget),
      maxInputPerPayment: BigInt(params.config.maxInputPerPayment),
      validAfter: BigInt(params.config.validAfter),
      validUntil: BigInt(params.config.validUntil),
      subsidyMode: subsidyOnchain,
      canonicalConfigBytes: Buffer.alloc(32),
      configProjection: params.config,
      observedStatus: 'ACTIVE',
      observedBlockHash: Buffer.alloc(32),
    });
    await insertPolicyMerchants(client, {
      policyId: result.row.id,
      merchants: params.merchants.map((m) => ({
        merchantId: Buffer.from(m.merchantId.slice(2), 'hex'),
        recipient: addr(m.recipient),
        invoiceSigner: addr(m.invoiceSigner),
        category: m.category,
      })),
    });
    return { policyId: result.row.id };
  });
  return { policyId };
}

export async function depositAsOwner(harness: WorkerHarness, amount: bigint): Promise<void> {
  await mintTokens(harness.fixture, harness.fixture.ownerAccount.address, amount);
  const approveHash = await harness.fixture.ownerWalletClient.writeContract({
    address: harness.fixture.tokenAddress,
    abi: harness.fixture.erc20Abi,
    functionName: 'approve',
    args: [harness.fixture.vaultAddress, amount],
    chain: null,
    account: harness.fixture.ownerAccount,
  } as never);
  await harness.fixture.publicClient.waitForTransactionReceipt({ hash: approveHash });
  const depositHash = await harness.fixture.ownerWalletClient.writeContract({
    address: harness.fixture.vaultAddress,
    abi: PAYGUARD_VAULT_ABI,
    functionName: 'deposit',
    args: [harness.fixture.tokenAddress, amount],
    chain: null,
    account: harness.fixture.ownerAccount,
  } as never);
  await harness.fixture.publicClient.waitForTransactionReceipt({ hash: depositHash });
}

export interface SeededPayment {
  vaultId: string;
  ownerWalletId: string;
  policyId: string;
  onchainPolicyId: `0x${string}`;
  paymentId: string;
  intentId: string;
  intentDigest: `0x${string}`;
  invoiceResourceId: string;
  merchantId: `0x${string}`;
  decision: 'ALLOW' | 'ESCALATE' | 'BLOCK' | 'UNKNOWN';
}

export interface SeedPaymentParams {
  vaultId: string;
  policyId: string;
  onchainPolicyId: `0x${string}`;
  merchantId: `0x${string}`;
  outputAmount: string;
  maxInputAmount: string;
}

/**
 * Builds a real-signed invoice+intent against an ALREADY-deployed policy, calling the REAL
 * on-chain `evaluate()` (never hardcoding a decision) -- mirroring exactly what
 * `apps/api`'s POST /v1/payment-intents does: invoice row, then signed intent, then evaluate,
 * then the payment row (carrying evaluate's actual decision), then SPEC-030's DRAFT ->
 * READY/AWAITING_APPROVAL transition.
 */
export async function seedPaymentForPolicy(
  harness: WorkerHarness,
  params: SeedPaymentParams,
): Promise<SeededPayment> {
  const eip712Domain = {
    chainId: harness.chainId,
    verifyingContract: harness.fixture.vaultAddress,
  };
  const invoice: Invoice = {
    invoiceId: `0x${randomBytes(32).toString('hex')}` as `0x${string}`,
    merchantId: params.merchantId,
    recipient: harness.fixture.merchantAccount.address,
    settlementToken: harness.fixture.tokenAddress,
    outputAmount: params.outputAmount,
    category: '0',
    validUntil: '99999999999',
  };
  const invoiceDigest = hashInvoice(eip712Domain, invoice);
  const merchantSignature = await harness.fixture.merchantAccount.sign({ hash: invoiceDigest });

  const { invoiceResourceId, invoiceRowId } = await withTransaction(
    harness.pool,
    async (client) => {
      const artifact = await createSignedArtifact(client, {
        id: uuid(),
        kind: 'INVOICE',
        digest: Buffer.from(invoiceDigest.slice(2), 'hex'),
        signer: Buffer.from(harness.fixture.merchantAccount.address.slice(2), 'hex'),
        encodedPayload: Buffer.from(JSON.stringify(invoice), 'utf8'),
        typedData: {
          domain: domainFor(eip712Domain),
          types: { Invoice: EIP712_TYPES.Invoice },
          primaryType: 'Invoice',
          message: invoice,
        },
        signature: Buffer.from(merchantSignature.slice(2), 'hex'),
        signatureHash: Buffer.from(keccak256(merchantSignature).slice(2), 'hex'),
        schemaVersion: '1',
      });
      const invoiceRow = await createOrGetInvoice(client, {
        id: uuid(),
        vaultId: params.vaultId,
        invoiceId: Buffer.from(invoice.invoiceId.slice(2), 'hex'),
        recipient: Buffer.from(invoice.recipient.slice(2), 'hex'),
        merchantId: Buffer.from(invoice.merchantId.slice(2), 'hex'),
        settlementToken: Buffer.from(invoice.settlementToken.slice(2), 'hex'),
        outputAmount: BigInt(invoice.outputAmount),
        validUntil: BigInt(invoice.validUntil),
        invoiceDigest: Buffer.from(invoiceDigest.slice(2), 'hex'),
        artifactId: artifact.id,
      });
      return { invoiceResourceId: invoiceRow.row.id, invoiceRowId: invoiceRow.row.id };
    },
  );

  const intent: PaymentIntent = {
    policyId: params.onchainPolicyId,
    invoiceHash: invoiceDigest,
    routeId: `0x${'0'.repeat(64)}` as `0x${string}`,
    maxInputAmount: params.maxInputAmount,
    nonce: Math.floor(Math.random() * 1e9).toString(10),
    validUntil: '99999999999',
    subsidyMode: 'NONE',
    maxSubsidyAmount: '0',
  };
  const intentDigest = hashIntent(eip712Domain, intent);
  const agentSignature = await harness.fixture.agentAccount.sign({ hash: intentDigest });

  // REAL evaluate() -- never hardcoded -- exactly mirroring what the API route does before
  // deciding policyDecision and the payment's initial executionStatus.
  const { createVaultReader } = await import('@payguard/chain');
  const reader = createVaultReader({
    publicClient: harness.fixture.publicClient,
    vaultAddress: harness.fixture.vaultAddress,
  });
  const evaluation = await reader.evaluate(invoice, intent, {
    agentSignature,
    merchantSignature,
  });

  const { paymentId, intentId } = await withTransaction(harness.pool, async (client) => {
    const payment = await createPaymentForInvoice(client, {
      id: uuid(),
      vaultId: params.vaultId,
      invoiceId: invoiceRowId,
      policyDecision: evaluation.decision,
    });

    const artifact = await createSignedArtifact(client, {
      id: uuid(),
      kind: 'INTENT',
      digest: Buffer.from(intentDigest.slice(2), 'hex'),
      signer: Buffer.from(harness.fixture.agentAccount.address.slice(2), 'hex'),
      encodedPayload: Buffer.from(JSON.stringify(intent), 'utf8'),
      typedData: {
        domain: domainFor(eip712Domain),
        types: { PaymentIntent: EIP712_TYPES.PaymentIntent },
        primaryType: 'PaymentIntent',
        message: intent,
      },
      signature: Buffer.from(agentSignature.slice(2), 'hex'),
      signatureHash: Buffer.from(keccak256(agentSignature).slice(2), 'hex'),
      schemaVersion: '1',
    });
    const intentRow = await createIntentVersion(client, {
      id: uuid(),
      paymentId: payment.row.id,
      vaultId: params.vaultId,
      policyId: params.policyId,
      version: 1n,
      intentDigest: Buffer.from(intentDigest.slice(2), 'hex'),
      artifactId: artifact.id,
      agentNonce: BigInt(intent.nonce),
      maxInputAmount: BigInt(intent.maxInputAmount),
      validUntil: BigInt(intent.validUntil),
    });

    // SPEC-030 (apps/api's POST /v1/payment-intents): DRAFT -> READY (ALLOW) or ->
    // AWAITING_APPROVAL (ESCALATE). BLOCK/UNKNOWN leave it at DRAFT, matching production exactly.
    const nextStatus =
      evaluation.decision === 'ALLOW'
        ? ('READY' as const)
        : evaluation.decision === 'ESCALATE'
          ? ('AWAITING_APPROVAL' as const)
          : undefined;
    if (nextStatus && isExecutionStatusTransitionAllowed(payment.row.executionStatus, nextStatus)) {
      await updatePaymentState(client, {
        paymentId: payment.row.id,
        expectedVersion: payment.row.stateVersion,
        current: {
          policyDecision: payment.row.policyDecision,
          executionStatus: payment.row.executionStatus,
          confidence: payment.row.confidence,
          reconciliation: payment.row.reconciliation,
        },
        next: { executionStatus: nextStatus },
      });
    }

    return { paymentId: payment.row.id, intentId: intentRow.id };
  });

  return {
    vaultId: params.vaultId,
    ownerWalletId: '', // filled by seedAllowedPayment; scenario tests should use seedOwnerVault directly
    policyId: params.policyId,
    onchainPolicyId: params.onchainPolicyId,
    paymentId,
    intentId,
    intentDigest,
    invoiceResourceId,
    merchantId: params.merchantId,
    decision: evaluation.decision,
  };
}

/** Builds a full ALLOW-eligible payment: real policy, real deposit, real-signed invoice+intent. */
export async function seedAllowedPayment(harness: WorkerHarness): Promise<SeededPayment> {
  const { vaultId, ownerWalletId } = await seedOwnerVault(harness);
  const config = directRouteConfig(harness);
  const merchantId = `0x${'d'.repeat(64)}` as `0x${string}`;
  const merchants = [
    {
      merchantId,
      recipient: harness.fixture.merchantAccount.address,
      invoiceSigner: harness.fixture.merchantAccount.address,
      category: 0,
    },
  ];
  const onchainPolicyId = await deployRealPolicy(harness, config, merchants);
  const { policyId } = await seedPolicyRow(harness, {
    vaultId,
    onchainPolicyId,
    config,
    merchants,
  });
  await depositAsOwner(harness, 5_000_000n);

  const seeded = await seedPaymentForPolicy(harness, {
    vaultId,
    policyId,
    onchainPolicyId,
    merchantId,
    outputAmount: '1000000',
    maxInputAmount: '1000000',
  });
  return { ...seeded, ownerWalletId };
}

export interface SeededSubmission {
  operationId: string;
  jobId: string;
}

/**
 * Real owner-signed exception approval for an ESCALATE intent, mirroring
 * apps/api's POST /v1/payment-intents/{id}/approvals: deterministic nonce = uint256(intentHash),
 * ERC-1271-style single-EOA-owner signature over the real EIP-712 ExceptionApproval digest.
 */
export async function seedOwnerApproval(
  harness: WorkerHarness,
  params: { intentId: string; vaultId: string; intentDigest: `0x${string}` },
): Promise<void> {
  const approval: ExceptionApproval = {
    intentHash: params.intentDigest,
    nonce: approvalNonceFromIntentHash(params.intentDigest),
    validUntil: '99999999999',
  };
  const eip712Domain = {
    chainId: harness.chainId,
    verifyingContract: harness.fixture.vaultAddress,
  };
  const digest = hashApproval(eip712Domain, approval);
  const ownerSignature = await harness.fixture.ownerAccount.sign({ hash: digest });

  await withTransaction(harness.pool, async (client) => {
    const artifact = await createSignedArtifact(client, {
      id: uuid(),
      kind: 'APPROVAL',
      digest: Buffer.from(digest.slice(2), 'hex'),
      signer: Buffer.from(harness.fixture.ownerAccount.address.slice(2), 'hex'),
      encodedPayload: Buffer.from(JSON.stringify(approval), 'utf8'),
      typedData: {
        domain: domainFor(eip712Domain),
        types: { ExceptionApproval: EIP712_TYPES.ExceptionApproval },
        primaryType: 'ExceptionApproval',
        message: approval,
      },
      signature: Buffer.from(ownerSignature.slice(2), 'hex'),
      signatureHash: Buffer.from(keccak256(ownerSignature).slice(2), 'hex'),
      schemaVersion: '1',
    });
    await createApproval(client, {
      id: uuid(),
      intentId: params.intentId,
      vaultId: params.vaultId,
      approvalDigest: Buffer.from(digest.slice(2), 'hex'),
      approvalNonce: BigInt(approval.nonce),
      artifactId: artifact.id,
      validUntil: BigInt(approval.validUntil),
    });
  });
}

/**
 * Mirrors apps/api's POST /v1/payment-intents/{id}/submit exactly, including SPEC-030's
 * READY|AWAITING_APPROVAL -> QUEUED transition and SPEC-031's CANCELLED -> READY -> QUEUED hop for
 * a legitimate resubmission of the same intent after its prior operation went terminal.
 */
export async function seedSubmission(
  harness: WorkerHarness,
  params: { paymentId: string; intentId: string; ownerWalletId: string },
): Promise<SeededSubmission> {
  const operationId = uuid();
  const jobId = uuid();
  await withTransaction(harness.pool, async (client) => {
    const payment = await getPaymentById(client, params.paymentId);
    if (payment) {
      let current = payment;
      if (current.executionStatus === 'CANCELLED') {
        const result = await updatePaymentState(client, {
          paymentId: current.id,
          expectedVersion: current.stateVersion,
          current: {
            policyDecision: current.policyDecision,
            executionStatus: current.executionStatus,
            confidence: current.confidence,
            reconciliation: current.reconciliation,
          },
          next: { executionStatus: 'READY' },
        });
        if (result.row) current = result.row;
      }
      if (isExecutionStatusTransitionAllowed(current.executionStatus, 'QUEUED')) {
        await updatePaymentState(client, {
          paymentId: current.id,
          expectedVersion: current.stateVersion,
          current: {
            policyDecision: current.policyDecision,
            executionStatus: current.executionStatus,
            confidence: current.confidence,
            reconciliation: current.reconciliation,
          },
          next: { executionStatus: 'QUEUED' },
        });
      }
    }
    await createOperation(client, {
      id: operationId,
      principalWalletId: params.ownerWalletId,
      deploymentId: harness.deploymentId,
      operationKind: 'SUBMIT_PAYMENT',
      resourceKind: 'payment_intent',
      resourceId: params.intentId,
      immutableRequest: Buffer.from(JSON.stringify({ intentId: params.intentId }), 'utf8'),
      requestDigest: Buffer.from(
        keccak256(`0x${Buffer.from(params.intentId).toString('hex')}`).slice(2),
        'hex',
      ),
    });
    await enqueue(client, {
      id: jobId,
      eventKey: `submit:${params.intentId}:${operationId}`,
      aggregateKind: 'payment_intent',
      aggregateId: params.intentId,
      eventType: 'PAYMENT_SUBMISSION_REQUESTED',
      payload: { intentId: params.intentId, paymentId: params.paymentId, operationId },
    });
  });
  return { operationId, jobId };
}

export function ownerAccount(harness: WorkerHarness) {
  return harness.fixture.ownerAccount;
}

export { privateKeyToAccount };
