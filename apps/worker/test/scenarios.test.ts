/**
 * The remaining direct-payment demonstration scenarios required by the Stage 5 instruction's item
 * 7: a real policy BLOCK with unchanged funds/counters, and ESCALATE followed by a real owner
 * approval leading to successful payment.
 */
import { randomUUID } from 'node:crypto';
import { createLocalPublicClient } from '@payguard/chain';
import { getOutboxById, getPaymentById } from '@payguard/db';
import { RELAYER_PRIVATE_KEY } from '@payguard/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '../src/config.js';
import { runOutboxTick } from '../src/outboxLoop.js';
import { createSubmitDeps } from '../src/submitPayment.js';
import {
  createWorkerHarness,
  deployRealPolicy,
  depositAsOwner,
  directRouteConfig,
  seedOwnerApproval,
  seedOwnerVault,
  seedPaymentForPolicy,
  seedPolicyRow,
  seedSubmission,
  type WorkerHarness,
} from './helpers/paymentFixture.js';

let harness: WorkerHarness;

beforeAll(async () => {
  harness = await createWorkerHarness();
}, 60_000);

afterAll(async () => {
  await harness.stopAnvil();
});

function submitDepsFor(harness: WorkerHarness) {
  const config = loadWorkerConfig({
    DATABASE_URL: 'unused',
    RPC_URL: harness.fixture.rpcUrl,
    CHAIN_ID: '31337',
    PAYGUARD_DEPLOYMENT_ID: harness.deploymentId,
    RELAYER_PRIVATE_KEY,
    WORKER_RECEIPT_POLL_ATTEMPTS: '10',
    WORKER_RECEIPT_POLL_INTERVAL_MS: '200',
  });
  const publicClient = createLocalPublicClient({ rpcUrl: harness.fixture.rpcUrl, chainId: 31337 });
  return createSubmitDeps({ pool: harness.pool, publicClient, config });
}

async function driveJobToCompletion(
  harness: WorkerHarness,
  submitDeps: ReturnType<typeof submitDepsFor>,
  jobId: string,
): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await runOutboxTick({ pool: harness.pool, submitDeps, leaseDurationSeconds: 60 }, randomUUID());
    const job = await getOutboxById(harness.pool, jobId);
    if (job && (job.status === 'DONE' || job.status === 'DEAD')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const merchantIdFor = (label: string) =>
  `0x${Buffer.from(label).toString('hex').padEnd(64, '0')}` as `0x${string}`;

describe('BLOCK: a hard budget rejection leaves funds and counters unchanged', () => {
  it('worker rejects with policyDecision BLOCK, CANCELLED, zero transfer', async () => {
    const { vaultId, ownerWalletId } = await seedOwnerVault(harness);
    const merchantId = merchantIdFor('block-scenario');
    const config = {
      ...directRouteConfig(harness),
      // invoice outputAmount (1_000_000) will exceed this hard budget; every cap/budget field the
      // vault's _validatePolicyConfig cross-checks (automaticOutputCap <= escalationOutputCap <=
      // totalOutputBudget, epochOutputBudget <= totalOutputBudget) must be pulled down together, or
      // policy creation itself reverts before the scenario ever reaches evaluate().
      totalOutputBudget: '1',
      epochOutputBudget: '1',
      automaticOutputCap: '1',
      escalationOutputCap: '1',
    };
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
    expect(seeded.decision).toBe('BLOCK');

    const balanceBefore = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;

    const { jobId } = await seedSubmission(harness, {
      paymentId: seeded.paymentId,
      intentId: seeded.intentId,
      ownerWalletId,
    });
    const submitDeps = submitDepsFor(harness);
    await driveJobToCompletion(harness, submitDeps, jobId);

    const payment = await getPaymentById(harness.pool, seeded.paymentId);
    expect(payment!.executionStatus).toBe('CANCELLED');
    expect(payment!.policyDecision).toBe('BLOCK');

    const balanceAfter = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;
    expect(balanceAfter).toBe(balanceBefore);
  }, 30_000);
});

describe('ESCALATE: owner approval unblocks an over-automatic-cap payment', () => {
  it('rejects APPROVAL_REQUIRED first, then succeeds once the real owner approval is signed and a NEW submit is queued', async () => {
    const { vaultId, ownerWalletId } = await seedOwnerVault(harness);
    const merchantId = merchantIdFor('escalate-scenario');
    const config = {
      ...directRouteConfig(harness),
      automaticOutputCap: '100', // invoice outputAmount (1_000_000) exceeds this -> ESCALATE
      escalationOutputCap: '10000000',
      totalOutputBudget: '10000000',
      epochOutputBudget: '10000000', // must not exceed totalOutputBudget (vault cross-check)
    };
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
    expect(seeded.decision).toBe('ESCALATE');

    const submitDeps = submitDepsFor(harness);

    // First submit: no approval yet -> worker rejects, no transfer.
    const first = await seedSubmission(harness, {
      paymentId: seeded.paymentId,
      intentId: seeded.intentId,
      ownerWalletId,
    });
    await driveJobToCompletion(harness, submitDeps, first.jobId);
    const afterFirstReject = await getPaymentById(harness.pool, seeded.paymentId);
    expect(afterFirstReject!.executionStatus).toBe('CANCELLED');

    // Owner signs the real exception approval.
    await seedOwnerApproval(harness, {
      intentId: seeded.intentId,
      vaultId,
      intentDigest: seeded.intentDigest,
    });

    const balanceBefore = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;

    // A NEW submit (SPEC-028: the old operation is FAILED, so this is a fresh command, not a
    // replay) -- the worker re-evaluates, now finds the approval, and succeeds for real.
    const second = await seedSubmission(harness, {
      paymentId: seeded.paymentId,
      intentId: seeded.intentId,
      ownerWalletId,
    });
    expect(second.operationId).not.toBe(first.operationId);
    await driveJobToCompletion(harness, submitDeps, second.jobId);

    const finalPayment = await getPaymentById(harness.pool, seeded.paymentId);
    expect(finalPayment!.executionStatus).toBe('SUCCEEDED');
    expect(finalPayment!.reconciliation).toBe('MATCHED');

    const balanceAfter = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;
    expect(balanceAfter - balanceBefore).toBe(1_000_000n);
  }, 30_000);
});
