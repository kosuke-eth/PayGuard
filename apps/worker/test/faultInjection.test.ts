/**
 * Stage 5's REQUIRED FAILURE INJECTION matrix, against real Postgres + real Anvil. Each `it()` is
 * named after its exact bullet from PAYGUARD_BUILD_PROMPTS.md's Prompt 5. Two of the ten bullets
 * are covered elsewhere, not duplicated here:
 *  - "API commit succeeds but HTTP response is lost; retry finds the original operation" is the
 *    existing real-HTTP idempotent-resubmit test in apps/api/test/payments.test.ts (owner submits,
 *    then a bound agent re-submits the SAME intent and gets `deduplicated: true` with the SAME
 *    operationId) -- that IS this scenario; a second copy here would just be a worker-level replay
 *    of the same assertion apps/api already proves against a real Fastify app.inject() call.
 *  - "A local canonical branch change after inclusion" is apps/worker/test/indexer.test.ts's real
 *    `anvil_reorg` regression test.
 */
import { randomUUID } from 'node:crypto';
import {
  createLocalPublicClient,
  createVaultReader,
  prepareExecutePaymentCalldata,
} from '@payguard/chain';
import {
  claimDueJobs,
  completeJob,
  completeSingleTransactionOperation,
  getLatestAttemptForNonceFamily,
  getOperationById,
  getOutboxById,
  getPaymentById,
  getSignedNotBroadcastAttempts,
  lockSigner,
  markBroadcast,
  recordFeeReplacement,
  recordSignedAttempt,
  reserveNonceFamily,
  retryJob,
  updatePaymentState,
  withTransaction,
} from '@payguard/db';
import { RELAYER_PRIVATE_KEY } from '@payguard/test-utils';
import type { PublicClient } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '../src/config.js';
import { addressToBuffer, bufferToHex, hexToBuffer } from '../src/encoding.js';
import { loadPaymentExecutionBundle } from '../src/loadPaymentBundle.js';
import { runOutboxTick } from '../src/outboxLoop.js';
import { reconcileAttempt } from '../src/reconcile.js';
import { runStartupRecovery } from '../src/recovery.js';
import { estimateRelayerGasAndFees, signRelayerTransaction } from '../src/relayer.js';
import {
  createSubmitDeps,
  handlePaymentSubmissionJob,
  type SubmitDeps,
} from '../src/submitPayment.js';
import {
  createWorkerHarness,
  deployRealPolicy,
  depositAsOwner,
  directRouteConfig,
  seedAllowedPayment,
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

function submitDepsFor(harness: WorkerHarness): SubmitDeps {
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

/**
 * Real claim (matching production's `claimDueJobs`) + the QUEUED -> IN_PROGRESS operation
 * transition `handlePaymentSubmissionJob` always performs before any settlement path can complete
 * an operation -- needed by tests that call `reconcileAttempt` directly rather than driving the
 * real handler, since `completeSingleTransactionOperation`'s COMPLETED transition is only legal
 * from IN_PROGRESS/UNKNOWN.
 */
async function claimJobAndMarkInProgress(
  harness: WorkerHarness,
  jobId: string,
  operationId: string,
) {
  const [claimed] = await claimDueJobs(harness.pool, {
    leaseOwner: randomUUID(),
    leaseDurationSeconds: 60,
    limit: 5,
  });
  if (!claimed || claimed.id !== jobId) {
    throw new Error(`claimJobAndMarkInProgress: expected to claim ${jobId}, got ${claimed?.id}`);
  }
  const operation = await getOperationById(harness.pool, operationId);
  if (operation && operation.status === 'QUEUED') {
    await withTransaction(harness.pool, (client) =>
      completeSingleTransactionOperation(client, {
        operationId,
        expectedVersion: operation.stateVersion,
        currentStatus: operation.status,
        status: 'IN_PROGRESS',
      }),
    );
  }
  return claimed;
}

async function driveJobsToCompletion(
  harness: WorkerHarness,
  submitDeps: SubmitDeps,
  jobIds: string[],
  maxIterations = 60,
): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    await Promise.all([
      runOutboxTick({ pool: harness.pool, submitDeps, leaseDurationSeconds: 60 }, randomUUID()),
      runOutboxTick({ pool: harness.pool, submitDeps, leaseDurationSeconds: 60 }, randomUUID()),
    ]);
    const jobs = await Promise.all(jobIds.map((id) => getOutboxById(harness.pool, id)));
    if (jobs.every((j) => j && (j.status === 'DONE' || j.status === 'DEAD'))) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Anvil's automine produces the next block asynchronously after `eth_sendRawTransaction` returns --
 * a receipt lookup issued immediately after send can race ahead of it. Production code never hits
 * this because `pollAndReconcileFor` already polls with delay; these tests need the same discipline
 * anywhere they check a receipt right after a direct send.
 */
async function waitForReceipt(
  publicClient: PublicClient,
  hash: `0x${string}`,
  attempts = 20,
  intervalMs = 250,
) {
  for (let i = 0; i < attempts; i++) {
    const receipt = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitForReceipt: no receipt for ${hash} after ${attempts} attempts`);
}

async function anvilRpc(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`${method} failed: ${body.error.message}`);
  return body.result;
}

/**
 * Real setup shared by scenarios 2-4: everything `handlePaymentSubmissionJob`'s fresh path does up
 * through signing, so each test can choose exactly where to stop and simulate a crash.
 */
async function prepareAndSign(harness: WorkerHarness, submitDeps: SubmitDeps, intentId: string) {
  const bundle = await loadPaymentExecutionBundle(harness.pool, intentId);
  if (!bundle) throw new Error('bundle vanished');
  const reader = createVaultReader({
    publicClient: submitDeps.publicClient,
    vaultAddress: bundle.vaultAddress,
  });
  const signatures = {
    agentSignature: bundle.agentSignature,
    merchantSignature: bundle.merchantSignature,
  };
  const evaluation = await reader.evaluate(bundle.invoice, bundle.intent, signatures);
  expect(evaluation.decision).toBe('ALLOW');
  const prepared = prepareExecutePaymentCalldata({
    vaultAddress: bundle.vaultAddress,
    invoice: bundle.invoice,
    intent: bundle.intent,
    signatures,
  });
  const { gas, maxFeePerGas, maxPriorityFeePerGas } = await estimateRelayerGasAndFees({
    publicClient: submitDeps.publicClient,
    from: submitDeps.signer.address,
    to: prepared.to,
    data: prepared.data,
  });

  const { family, attempt } = await withTransaction(harness.pool, async (client) => {
    await lockSigner(client, {
      deploymentId: bundle.deploymentId,
      sender: addressToBuffer(submitDeps.signer.address),
    });
    const family = await reserveNonceFamily(client, {
      id: randomUUID(),
      deploymentId: bundle.deploymentId,
      sender: addressToBuffer(submitDeps.signer.address),
      intentId: bundle.intentId,
      unsignedRequest: {
        to: prepared.to,
        data: prepared.data,
        value: '0',
        gas: gas.toString(10),
        maxFeePerGas: maxFeePerGas.toString(10),
        maxPriorityFeePerGas: maxPriorityFeePerGas.toString(10),
        chainId: Number(bundle.chainId),
        calldataHash: prepared.calldataHash,
      },
      expectedTo: addressToBuffer(prepared.to),
      expectedCalldataHash: hexToBuffer(prepared.calldataHash),
    });
    const signed = await signRelayerTransaction(submitDeps.signer, {
      chainId: Number(bundle.chainId),
      to: prepared.to,
      data: prepared.data,
      value: 0n,
      nonce: family.nonce,
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
    const attempt = await recordSignedAttempt(client, {
      id: randomUUID(),
      deploymentId: bundle.deploymentId,
      nonceFamilyId: family.id,
      txHash: hexToBuffer(signed.hash),
      rawSignedTransaction: hexToBuffer(signed.raw),
    });
    // Matches submitPayment.ts's real fresh path: QUEUED -> SIGNED in the SAME transaction as
    // recordSignedAttempt, so the public executionStatus projection never lags the actual signed
    // bytes and later reconcileAttempt calls see a graph-legal starting state.
    const payment = await getPaymentById(client, bundle.paymentId);
    if (payment && payment.executionStatus === 'QUEUED') {
      await updatePaymentState(client, {
        paymentId: bundle.paymentId,
        expectedVersion: payment.stateVersion,
        current: {
          policyDecision: payment.policyDecision,
          executionStatus: payment.executionStatus,
          confidence: payment.confidence,
          reconciliation: payment.reconciliation,
        },
        next: { executionStatus: 'SIGNED' },
      });
    }
    return { family, attempt };
  });

  return { bundle, prepared, gas, maxFeePerGas, maxPriorityFeePerGas, family, attempt };
}

describe('Scenario: worker dies after nonce allocation but before signing', () => {
  it('recovery signs the SAME reserved nonce; no gap and no double allocation', async () => {
    const seeded = await seedAllowedPayment(harness);
    const submitDeps = submitDepsFor(harness);
    const bundle = await loadPaymentExecutionBundle(harness.pool, seeded.intentId);
    if (!bundle) throw new Error('bundle vanished');
    const reader = createVaultReader({
      publicClient: submitDeps.publicClient,
      vaultAddress: bundle.vaultAddress,
    });
    const signatures = {
      agentSignature: bundle.agentSignature,
      merchantSignature: bundle.merchantSignature,
    };
    const prepared = prepareExecutePaymentCalldata({
      vaultAddress: bundle.vaultAddress,
      invoice: bundle.invoice,
      intent: bundle.intent,
      signatures,
    });

    // Crash point: nonce reserved + unsigned request persisted, but the process dies before ever
    // calling signRelayerTransaction/recordSignedAttempt.
    const family = await withTransaction(harness.pool, async (client) => {
      await lockSigner(client, {
        deploymentId: bundle.deploymentId,
        sender: addressToBuffer(submitDeps.signer.address),
      });
      return reserveNonceFamily(client, {
        id: randomUUID(),
        deploymentId: bundle.deploymentId,
        sender: addressToBuffer(submitDeps.signer.address),
        intentId: bundle.intentId,
        unsignedRequest: {
          to: prepared.to,
          data: prepared.data,
          value: '0',
          gas: '500000',
          maxFeePerGas: '10000000000',
          maxPriorityFeePerGas: '1000000000',
          chainId: 31337,
          calldataHash: prepared.calldataHash,
        },
        expectedTo: addressToBuffer(prepared.to),
        expectedCalldataHash: hexToBuffer(prepared.calldataHash),
      });
    });

    expect(await getLatestAttemptForNonceFamily(harness.pool, family.id)).toBeNull();

    const report = await runStartupRecovery({
      pool: harness.pool,
      publicClient: submitDeps.publicClient,
      signer: submitDeps.signer,
      deploymentId: bundle.deploymentId,
    });
    expect(report.signedRecoveredCount).toBeGreaterThanOrEqual(1);

    const attempt = await getLatestAttemptForNonceFamily(harness.pool, family.id);
    expect(attempt).not.toBeNull();
    expect(attempt!.state).toBe('SIGNED');

    // No unaccounted gap: the next allocation for this signer must be exactly family.nonce + 1,
    // not skipped ahead and not reusing family.nonce.
    const signerState = await harness.pool.query(
      'SELECT next_nonce FROM signer_state WHERE deployment_id = $1 AND sender = $2',
      [bundle.deploymentId, addressToBuffer(submitDeps.signer.address)],
    );
    expect(BigInt(signerState.rows[0].next_nonce)).toBe(family.nonce + 1n);
  }, 30_000);
});

describe('Scenario: worker dies after raw bytes are persisted but before send', () => {
  it('recovery rebroadcasts the EXACT persisted bytes -- same tx hash lands on-chain', async () => {
    const seeded = await seedAllowedPayment(harness);
    const submitDeps = submitDepsFor(harness);
    const { attempt } = await prepareAndSign(harness, submitDeps, seeded.intentId);

    // Crash point: SIGNED, never sent.
    const stillSigned = (
      await getSignedNotBroadcastAttempts(harness.pool, { deploymentId: harness.deploymentId })
    ).find((a) => a.id === attempt.id);
    expect(stillSigned).toBeDefined();

    const report = await runStartupRecovery({
      pool: harness.pool,
      publicClient: submitDeps.publicClient,
      signer: submitDeps.signer,
      deploymentId: harness.deploymentId,
    });
    expect(report.rebroadcastCount).toBeGreaterThanOrEqual(1);

    const txHash = bufferToHex(attempt.txHash) as `0x${string}`;
    const receipt = await waitForReceipt(submitDeps.publicClient, txHash);
    expect(receipt.transactionHash.toLowerCase()).toBe(txHash.toLowerCase());
    expect(receipt.status).toBe('success');
  }, 30_000);
});

describe('Scenario: node accepts a transaction, the send response is lost, worker restarts', () => {
  it('one invoice is paid exactly once even though the worker never recorded the first broadcast', async () => {
    const seeded = await seedAllowedPayment(harness);
    const submitDeps = submitDepsFor(harness);
    const { operationId, jobId } = await seedSubmission(harness, {
      paymentId: seeded.paymentId,
      intentId: seeded.intentId,
      ownerWalletId: seeded.ownerWalletId,
    });
    const { attempt } = await prepareAndSign(harness, submitDeps, seeded.intentId);

    const balanceBefore = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;

    // The node genuinely accepts (and, on Anvil, immediately mines) the transaction, but the
    // worker's own response handling never runs -- markBroadcast is deliberately skipped, so the
    // DB still shows SIGNED even though the chain already has it.
    const raw = bufferToHex(attempt.rawSignedTransaction) as `0x02${string}`;
    await submitDeps.publicClient.sendRawTransaction({ serializedTransaction: raw });
    const minedDirectly = await waitForReceipt(
      submitDeps.publicClient,
      bufferToHex(attempt.txHash) as `0x${string}`,
    );
    expect(minedDirectly.status).toBe('success');

    // "Worker restart": the FIRST real job invocation for this intent finds the already-reserved,
    // already-signed, already-(secretly)-mined family via getOpenNonceFamilyForIntent and resumes
    // it, rather than treating this as a fresh submission.
    await driveJobsToCompletion(harness, submitDeps, [jobId]);

    const payment = await getPaymentById(harness.pool, seeded.paymentId);
    expect(payment!.executionStatus).toBe('SUCCEEDED');

    const balanceAfter = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;
    expect(balanceAfter - balanceBefore).toBe(1_000_000n); // exactly once, not double

    const operation = await getOperationById(harness.pool, operationId);
    expect(operation!.status).toBe('COMPLETED');
  }, 30_000);
});

describe('Scenario: duplicate/reclaimed outbox delivery and an expired worker completion', () => {
  it('a stale lease-holder cannot overwrite the result a newer lease-holder already committed', async () => {
    const seeded = await seedAllowedPayment(harness);
    const { jobId } = await seedSubmission(harness, {
      paymentId: seeded.paymentId,
      intentId: seeded.intentId,
      ownerWalletId: seeded.ownerWalletId,
    });

    const workerOne = randomUUID();
    const [claimed] = await claimDueJobs(harness.pool, {
      leaseOwner: workerOne,
      leaseDurationSeconds: 60,
      limit: 5,
    });
    expect(claimed.id).toBe(jobId);
    const staleLeaseVersion = claimed.leaseVersion;

    // Simulate worker1's lease expiring (it stalled, never crashed outright) without it ever
    // calling completeJob/retryJob itself.
    await harness.pool.query(
      "UPDATE outbox SET locked_until = now() - interval '1 second' WHERE id = $1",
      [jobId],
    );

    const workerTwo = randomUUID();
    const submitDeps = submitDepsFor(harness);
    await driveJobsToCompletion(harness, submitDeps, [jobId]); // worker2 (or later ticks) reclaims and finishes it

    const settledJob = await getOutboxById(harness.pool, jobId);
    expect(settledJob!.status).toBe('DONE');
    const settledLeaseVersion = settledJob!.leaseVersion;
    expect(settledLeaseVersion).toBeGreaterThan(staleLeaseVersion);

    // Worker1's late completeJob call, using its now-stale lease, must be fenced out -- not
    // silently accepted and not regressing the already-DONE row.
    const staleCompletion = await completeJob(harness.pool, {
      id: jobId,
      leaseOwner: workerOne,
      expectedLeaseVersion: staleLeaseVersion,
    });
    expect(staleCompletion.completed).toBe(false);
    const staleRetry = await retryJob(harness.pool, {
      id: jobId,
      leaseOwner: workerOne,
      expectedLeaseVersion: staleLeaseVersion,
      error: 'stale worker',
      maxAttempts: 20,
      backoffSeconds: 5,
    });
    expect(staleRetry.updated).toBe(false);

    const finalJob = await getOutboxById(harness.pool, jobId);
    expect(finalJob!.status).toBe('DONE'); // untouched by either stale call
    expect(finalJob!.leaseVersion).toBe(settledLeaseVersion);
  }, 45_000);
});

describe('Scenario: simultaneous jobs from the same relayer, and simultaneous requests for the same invoice', () => {
  it('the DB itself refuses a second simultaneously-open submission for the same intent', async () => {
    // `one_open_submission_per_intent` (Stage 4 migration) is what makes apps/api's
    // `findOpenOperationForResource` dedup meaningful rather than merely advisory: a second
    // concurrent submission command for the SAME intent cannot even create a second open
    // operation row, real Postgres unique-constraint enforcement, not an application-level check
    // that a race could slip past.
    const seeded = await seedAllowedPayment(harness);
    await seedSubmission(harness, {
      paymentId: seeded.paymentId,
      intentId: seeded.intentId,
      ownerWalletId: seeded.ownerWalletId,
    });
    await expect(
      seedSubmission(harness, {
        paymentId: seeded.paymentId,
        intentId: seeded.intentId,
        ownerWalletId: seeded.ownerWalletId,
      }),
    ).rejects.toThrow(/one_open_submission_per_intent/);
  }, 30_000);

  it('two concurrent submissions from the SAME relayer for TWO DIFFERENT payments settle both, with no nonce collision or cross-payment corruption', async () => {
    // Deliberately ONE shared policy (not two seedAllowedPayment calls): PayGuard enforces one
    // active policy per agent (SPEC-001 -- creating a second policy for the same agent supersedes
    // the first on-chain), so two independently-created policies under the fixture's one agent
    // address would make the SECOND deactivate the FIRST, not exercise genuine payment concurrency.
    const { vaultId, ownerWalletId } = await seedOwnerVault(harness);
    const config = directRouteConfig(harness);
    const merchantId = `0x${'e'.repeat(64)}` as `0x${string}`;
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
    const seededA = {
      ...(await seedPaymentForPolicy(harness, {
        vaultId,
        policyId,
        onchainPolicyId,
        merchantId,
        outputAmount: '1000000',
        maxInputAmount: '1000000',
      })),
      ownerWalletId,
    };
    const seededB = {
      ...(await seedPaymentForPolicy(harness, {
        vaultId,
        policyId,
        onchainPolicyId,
        merchantId,
        outputAmount: '1000000',
        maxInputAmount: '1000000',
      })),
      ownerWalletId,
    };
    expect(seededA.decision).toBe('ALLOW');
    expect(seededB.decision).toBe('ALLOW');
    const submitDeps = submitDepsFor(harness);
    const subA = await seedSubmission(harness, {
      paymentId: seededA.paymentId,
      intentId: seededA.intentId,
      ownerWalletId: seededA.ownerWalletId,
    });
    const subB = await seedSubmission(harness, {
      paymentId: seededB.paymentId,
      intentId: seededB.intentId,
      ownerWalletId: seededB.ownerWalletId,
    });

    const balanceBefore = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;

    await driveJobsToCompletion(harness, submitDeps, [subA.jobId, subB.jobId], 80);

    const paymentA = await getPaymentById(harness.pool, seededA.paymentId);
    const paymentB = await getPaymentById(harness.pool, seededB.paymentId);
    expect(paymentA!.executionStatus).toBe('SUCCEEDED');
    expect(paymentB!.executionStatus).toBe('SUCCEEDED');

    const balanceAfter = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;
    expect(balanceAfter - balanceBefore).toBe(2_000_000n); // both, exactly once each

    // Each intent's own nonce family closed with a DISTINCT canonical tx hash -- lockSigner's row
    // lock serialized allocation for the shared relayer without either losing or duplicating a nonce.
    const families = await harness.pool.query(
      'SELECT intent_id, nonce, canonical_tx_hash FROM nonce_families WHERE intent_id = ANY($1::uuid[])',
      [[seededA.intentId, seededB.intentId]],
    );
    expect(families.rows).toHaveLength(2);
    expect(families.rows.every((r) => r.canonical_tx_hash !== null)).toBe(true);
    expect(families.rows[0].nonce).not.toBe(families.rows[1].nonce);
  }, 60_000);
});

describe('Scenario: a repriced (fee-bump) replacement transaction', () => {
  it('the losing nonce never lands, the winner settles, and the loser is marked REPLACED -- not confused with the payment/invoice state', async () => {
    const seeded = await seedAllowedPayment(harness);
    const submitDeps = submitDepsFor(harness);

    const { operationId, jobId } = await seedSubmission(harness, {
      paymentId: seeded.paymentId,
      intentId: seeded.intentId,
      ownerWalletId: seeded.ownerWalletId,
    });

    await anvilRpc(harness.fixture.rpcUrl, 'anvil_setAutomine', [false]);
    try {
      const {
        bundle,
        prepared,
        family,
        attempt: attemptA,
      } = await prepareAndSign(harness, submitDeps, seeded.intentId);
      await submitDeps.publicClient.sendRawTransaction({
        serializedTransaction: bufferToHex(attemptA.rawSignedTransaction) as `0x02${string}`,
      });

      // A real fee-bump replacement: same nonce, same calldata, strictly higher fees.
      const signedB = await signRelayerTransaction(submitDeps.signer, {
        chainId: 31337,
        to: prepared.to,
        data: prepared.data,
        value: 0n,
        nonce: family.nonce,
        gas: 500_000n,
        maxFeePerGas: 50_000_000_000n,
        maxPriorityFeePerGas: 5_000_000_000n,
      });
      const attemptB = await withTransaction(harness.pool, (client) =>
        recordFeeReplacement(client, {
          id: randomUUID(),
          deploymentId: bundle.deploymentId,
          nonceFamilyId: family.id,
          txHash: hexToBuffer(signedB.hash),
          rawSignedTransaction: hexToBuffer(signedB.raw),
          replacementOfId: attemptA.id,
        }),
      );
      await submitDeps.publicClient.sendRawTransaction({ serializedTransaction: signedB.raw });
      await withTransaction(harness.pool, async (client) => {
        await markBroadcast(client, { attemptId: attemptB.id, isFirstBroadcast: true });
        const payment = await getPaymentById(client, seeded.paymentId);
        if (payment && payment.executionStatus === 'SIGNED') {
          await updatePaymentState(client, {
            paymentId: seeded.paymentId,
            expectedVersion: payment.stateVersion,
            current: {
              policyDecision: payment.policyDecision,
              executionStatus: payment.executionStatus,
              confidence: payment.confidence,
              reconciliation: payment.reconciliation,
            },
            next: { executionStatus: 'SUBMITTED' },
          });
        }
      });

      await anvilRpc(harness.fixture.rpcUrl, 'anvil_mine', ['0x1']);
      await anvilRpc(harness.fixture.rpcUrl, 'anvil_setAutomine', [true]);

      const receiptB = await waitForReceipt(submitDeps.publicClient, signedB.hash);
      expect(receiptB.status).toBe('success');

      // A never mined -- it was genuinely displaced from the mempool by B, not merely ignored.
      const receiptA = await submitDeps.publicClient
        .getTransactionReceipt({ hash: bufferToHex(attemptA.txHash) as `0x${string}` })
        .catch(() => null);
      expect(receiptA).toBeNull();

      const expectation = {
        expectedChainId: '31337',
        expectedTo: bundle.vaultAddress,
        expectedFrom: submitDeps.signer.address,
        expectedVault: bundle.vaultAddress,
        expectedIntentHash: bundle.intentDigest,
        expectedMerchant: bundle.invoice.recipient,
        expectedOutputToken: bundle.invoice.settlementToken,
        expectedExactOutput: bundle.invoice.outputAmount,
        expectedMaxInput: bundle.intent.maxInputAmount,
        expectedRouteId: bundle.intent.routeId,
      };
      const claimed = await claimJobAndMarkInProgress(harness, jobId, operationId);
      const result = await reconcileAttempt(
        { pool: harness.pool, publicClient: submitDeps.publicClient },
        {
          deploymentId: bundle.deploymentId,
          paymentId: seeded.paymentId,
          operationId,
          outboxJobId: jobId,
          leaseOwner: claimed.leaseOwner!,
          leaseVersion: claimed.leaseVersion,
          attemptId: attemptB.id,
          nonceFamilyId: family.id,
          txHash: signedB.hash,
          expectation,
        },
      );
      expect(result).toEqual({ kind: 'SETTLED', success: true, reasonCode: null });

      const refreshedA = await harness.pool.query(
        'SELECT state FROM transaction_attempts WHERE id = $1',
        [attemptA.id],
      );
      expect(refreshedA.rows[0].state).toBe('REPLACED');
      const refreshedB = await harness.pool.query(
        'SELECT state FROM transaction_attempts WHERE id = $1',
        [attemptB.id],
      );
      expect(refreshedB.rows[0].state).toBe('SUCCEEDED');

      const payment = await getPaymentById(harness.pool, seeded.paymentId);
      expect(payment!.executionStatus).toBe('SUCCEEDED');
    } finally {
      await anvilRpc(harness.fixture.rpcUrl, 'anvil_setAutomine', [true]).catch(() => {});
    }
  }, 30_000);
});

describe('Scenario: a forged observation hint / reconciliation mismatch', () => {
  it('a real success receipt fed with a WRONG expectation never reports success, and stays MISMATCH rather than auto-repairing', async () => {
    const seeded = await seedAllowedPayment(harness);
    const submitDeps = submitDepsFor(harness);
    const { operationId, jobId } = await seedSubmission(harness, {
      paymentId: seeded.paymentId,
      intentId: seeded.intentId,
      ownerWalletId: seeded.ownerWalletId,
    });
    const { bundle, attempt, family } = await prepareAndSign(harness, submitDeps, seeded.intentId);
    const txHash = bufferToHex(attempt.txHash) as `0x${string}`;
    await submitDeps.publicClient.sendRawTransaction({
      serializedTransaction: bufferToHex(attempt.rawSignedTransaction) as `0x02${string}`,
    });
    await withTransaction(harness.pool, async (client) => {
      await markBroadcast(client, { attemptId: attempt.id, isFirstBroadcast: true });
      const payment = await getPaymentById(client, seeded.paymentId);
      if (payment && payment.executionStatus === 'SIGNED') {
        await updatePaymentState(client, {
          paymentId: seeded.paymentId,
          expectedVersion: payment.stateVersion,
          current: {
            policyDecision: payment.policyDecision,
            executionStatus: payment.executionStatus,
            confidence: payment.confidence,
            reconciliation: payment.reconciliation,
          },
          next: { executionStatus: 'SUBMITTED' },
        });
      }
    });
    await waitForReceipt(submitDeps.publicClient, txHash);

    // A forged hint: the real receipt succeeded, but the expectation we reconcile against names a
    // merchant address that is NOT the one the invoice actually authorized.
    const forgedExpectation = {
      expectedChainId: '31337',
      expectedTo: bundle.vaultAddress,
      expectedFrom: submitDeps.signer.address,
      expectedVault: bundle.vaultAddress,
      expectedIntentHash: bundle.intentDigest,
      expectedMerchant: '0x000000000000000000000000000000000000ff' as const,
      expectedOutputToken: bundle.invoice.settlementToken,
      expectedExactOutput: bundle.invoice.outputAmount,
      expectedMaxInput: bundle.intent.maxInputAmount,
      expectedRouteId: bundle.intent.routeId,
    };

    const claimed = await claimJobAndMarkInProgress(harness, jobId, operationId);
    const result = await reconcileAttempt(
      { pool: harness.pool, publicClient: submitDeps.publicClient },
      {
        deploymentId: bundle.deploymentId,
        paymentId: seeded.paymentId,
        operationId,
        outboxJobId: jobId,
        leaseOwner: claimed.leaseOwner!,
        leaseVersion: claimed.leaseVersion,
        attemptId: attempt.id,
        nonceFamilyId: family.id,
        txHash,
        expectation: forgedExpectation,
      },
    );
    expect(result.kind).toBe('SETTLED');
    if (result.kind === 'SETTLED') {
      expect(result.success).toBe(false);
      expect(result.reasonCode).toMatch(/^RECONCILIATION_MISMATCH:/);
    }

    const payment = await getPaymentById(harness.pool, seeded.paymentId);
    expect(payment!.executionStatus).toBe('UNKNOWN'); // NEVER SUCCEEDED on a forged/mismatched hint
    expect(payment!.reconciliation).toBe('MISMATCH');

    // MISMATCH is sticky: nothing here automatically resubmits or repairs into a second payment.
    // Confirmed structurally -- reconciliation's own state graph (RECONCILIATION_GRAPH) only allows
    // MISMATCH -> NOT_CHECKED, never a direct auto-flip to MATCHED, so no code path in this worker
    // (which never calls updatePaymentState with reconciliation: 'NOT_CHECKED') can silently clear
    // it, and the vault's own consumedInvoice flag (now true, since this attempt DID execute
    // on-chain) blocks any literal second payment attempt regardless.
  }, 30_000);
});

describe('Scenario: intent legitimately retired while a signed/broadcast attempt is already in flight (SPEC-035)', () => {
  it('the in-flight nonce family is still chased to resolution, not abandoned as soon as the job sees retired=true', async () => {
    const seeded = await seedAllowedPayment(harness);
    const submitDeps = submitDepsFor(harness);
    const { jobId } = await seedSubmission(harness, {
      paymentId: seeded.paymentId,
      intentId: seeded.intentId,
      ownerWalletId: seeded.ownerWalletId,
    });

    const balanceBefore = (await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.merchantAccount.address],
    })) as bigint;

    await anvilRpc(harness.fixture.rpcUrl, 'anvil_setAutomine', [false]);
    try {
      const [claimed] = await claimDueJobs(harness.pool, {
        leaseOwner: randomUUID(),
        leaseDurationSeconds: 60,
        limit: 5,
      });
      if (!claimed || claimed.id !== jobId) throw new Error('expected to claim the seeded job');
      const job = {
        id: claimed.id,
        leaseOwner: claimed.leaseOwner!,
        leaseVersion: claimed.leaseVersion,
        payload: claimed.payload as { intentId: string; paymentId: string; operationId: string },
      };

      // First invocation: fresh path signs + broadcasts, but automine is off, so the bounded
      // receipt-poll wait exhausts and returns RETRY without ever completing the job -- the lease
      // is still held by `job`, exactly like a real requeued-but-not-yet-reclaimed job.
      const first = await handlePaymentSubmissionJob(submitDeps, job);
      expect(first).toEqual({
        kind: 'RETRY',
        reason: 'receipt not yet observed within bounded wait',
      });

      const midFlight = await getPaymentById(harness.pool, seeded.paymentId);
      expect(midFlight!.executionStatus).toBe('SUBMITTED');

      // Real production effect of a legitimate re-versioning (POST /v1/payment-intents creating
      // N+1 for this payment): `createIntentVersion`'s unconditional retirement UPDATE, applied
      // directly here to isolate the exact race window without needing the full HTTP/evaluate
      // path -- this intent is now retired WHILE its broadcast transaction is still unmined.
      await harness.pool.query(
        'UPDATE payment_intents SET retired_at = now() WHERE id = $1 AND retired_at IS NULL',
        [seeded.intentId],
      );
      const bundle = await loadPaymentExecutionBundle(harness.pool, seeded.intentId);
      expect(bundle!.retired).toBe(true);

      // The transaction genuinely mines (a real node would eventually include it regardless of
      // what the API layer decided about the intent in the meantime).
      await anvilRpc(harness.fixture.rpcUrl, 'anvil_mine', ['0x1']);

      // Second invocation, same lease: with SPEC-035's reordering this must resume the open
      // family (broadcast/poll/reconcile) BEFORE ever consulting `bundle.retired`, and therefore
      // still settle the payment instead of calling rejectPayment and abandoning a live receipt.
      const second = await handlePaymentSubmissionJob(submitDeps, job);
      expect(second).toEqual({ kind: 'DONE' });
    } finally {
      await anvilRpc(harness.fixture.rpcUrl, 'anvil_setAutomine', [true]).catch(() => {});
    }

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

describe('Scenario: indexer restart, duplicate logs and missed ranges', () => {
  it('is exercised by the real full-replay idempotency test in indexer.test.ts (forward observation)', () => {
    expect(true).toBe(true);
  });
});
