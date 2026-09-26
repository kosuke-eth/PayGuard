/**
 * The PAYMENT_SUBMISSION_REQUESTED outbox handler: exact execution preparation (item 2), the
 * nonce-journal/signing boundary (item 3), broadcast (item 4), and a bounded in-invocation receipt
 * wait that hands off to `reconcileAttempt` (item 5/6) -- or, if nothing has been mined yet within
 * that bound, returns RETRY so the outbox's own bounded-backoff requeue drives the next attempt.
 *
 * Every invocation (fresh delivery or a reclaimed/duplicate one) starts by asking "does this
 * intent already have an OPEN nonce family?" -- never "was this the first time I've seen this
 * job?". That is what makes a reclaimed job resume instead of re-signing (recovery table rows
 * 3-9): a SIGNED-not-broadcast attempt gets (re)broadcast, a SUBMITTED/UNKNOWN attempt only gets
 * polled, and only a genuinely absent family triggers the full evaluate/simulate/reserve/sign path.
 */
import { randomUUID } from 'node:crypto';
import {
  createVaultReader,
  type PaymentExecutionExpectation,
  prepareExecutePaymentCalldata,
  type SignatureSet,
} from '@payguard/chain';
import {
  completeJob,
  completeSingleTransactionOperation,
  getLatestAttemptForNonceFamily,
  getOpenNonceFamilyForIntent,
  getOperationById,
  getPaymentById,
  hasUnresolvedNonceGap,
  insertTimelineEvent,
  isExecutionStatusTransitionAllowed,
  isOperationStatusTransitionAllowed,
  lockSigner,
  markBroadcast,
  recordSignedAttempt,
  reserveNonceFamily,
  type TransactionAttemptRow,
  updatePaymentState,
  withTransaction,
} from '@payguard/db';
import type pg from 'pg';
import type { PublicClient } from 'viem';
import type { WorkerConfig } from './config.js';
import { addressToBuffer, bufferToHex, hexToBuffer } from './encoding.js';
import { loadPaymentExecutionBundle, type PaymentExecutionBundle } from './loadPaymentBundle.js';
import { reconcileAttempt } from './reconcile.js';
import {
  createRelayerSigner,
  estimateRelayerGasAndFees,
  type RelayerSigner,
  signRelayerTransaction,
} from './relayer.js';

export interface SubmitDeps {
  pool: pg.Pool;
  publicClient: PublicClient;
  signer: RelayerSigner;
  config: WorkerConfig;
}

export function createSubmitDeps(params: {
  pool: pg.Pool;
  publicClient: PublicClient;
  config: WorkerConfig;
}): SubmitDeps {
  return {
    pool: params.pool,
    publicClient: params.publicClient,
    signer: createRelayerSigner(params.config.relayerPrivateKey),
    config: params.config,
  };
}

export interface SubmitJobPayload {
  intentId: string;
  paymentId: string;
  operationId: string;
}

export type SubmitJobResult = { kind: 'DONE' } | { kind: 'RETRY'; reason: string };

function buildSignatureSet(bundle: PaymentExecutionBundle): SignatureSet {
  return bundle.approval && bundle.ownerSignature
    ? {
        agentSignature: bundle.agentSignature,
        merchantSignature: bundle.merchantSignature,
        approval: bundle.approval,
        ownerSignature: bundle.ownerSignature,
      }
    : { agentSignature: bundle.agentSignature, merchantSignature: bundle.merchantSignature };
}

async function rejectPayment(
  deps: SubmitDeps,
  bundle: PaymentExecutionBundle,
  job: { id: string; leaseOwner: string; leaseVersion: bigint; payload: SubmitJobPayload },
  reasonCode: string,
  policyDecision?: 'ALLOW' | 'ESCALATE' | 'BLOCK',
): Promise<void> {
  const operationId = job.payload.operationId;
  await withTransaction(deps.pool, async (client) => {
    const payment = await getPaymentById(client, bundle.paymentId);
    if (payment && isExecutionStatusTransitionAllowed(payment.executionStatus, 'CANCELLED')) {
      // SPEC-033: a same-to-same policyDecision transition is illegal by design
      // (state_transitions.ts: "a transition to the same state is a no-op, not a transition") --
      // the caller's fresh evaluate() almost always reconfirms the SAME decision the payment was
      // created with (e.g. BLOCK -> BLOCK), so this must only be included when it actually
      // changed, exactly like paymentIntents.ts's POST /v1/payment-intents already does.
      await updatePaymentState(client, {
        paymentId: bundle.paymentId,
        expectedVersion: payment.stateVersion,
        current: {
          policyDecision: payment.policyDecision,
          executionStatus: payment.executionStatus,
          confidence: payment.confidence,
          reconciliation: payment.reconciliation,
        },
        next: {
          executionStatus: 'CANCELLED',
          reasonCode,
          ...(policyDecision !== undefined && policyDecision !== payment.policyDecision
            ? { policyDecision }
            : {}),
        },
      });
    }
    const operation = await getOperationById(client, operationId);
    if (operation && operation.status !== 'COMPLETED' && operation.status !== 'FAILED') {
      await completeSingleTransactionOperation(client, {
        operationId,
        expectedVersion: operation.stateVersion,
        currentStatus: operation.status,
        status: 'FAILED',
      });
    }
    await insertTimelineEvent(client, {
      id: randomUUID(),
      paymentId: bundle.paymentId,
      eventKey: `reject:${operationId}:${reasonCode}`,
      eventType: 'PAYMENT_REJECTED',
      body: { reasonCode },
    });
    // Terminal for THIS submission attempt -- a genuinely new command (e.g. after the owner
    // supplies the missing approval) is a fresh POST /submit with its own operation/eventKey
    // (SPEC-028), not something this job should keep retrying toward.
    await completeJob(client, {
      id: job.id,
      leaseOwner: job.leaseOwner,
      expectedLeaseVersion: job.leaseVersion,
    });
  });
}

/**
 * QUEUED -> IN_PROGRESS, the moment the worker actually starts acting on an operation.
 * `completeSingleTransactionOperation`'s later COMPLETED transition is only legal from
 * IN_PROGRESS/UNKNOWN (never directly from QUEUED), so every code path that might eventually
 * settle a payment must pass through here first. Idempotent -- a resumed/redelivered job that
 * already marked this operation IN_PROGRESS (or moved it further) is a no-op, not an error.
 */
async function markOperationInProgress(deps: SubmitDeps, operationId: string): Promise<void> {
  await withTransaction(deps.pool, async (client) => {
    const operation = await getOperationById(client, operationId);
    if (operation && isOperationStatusTransitionAllowed(operation.status, 'IN_PROGRESS')) {
      await completeSingleTransactionOperation(client, {
        operationId,
        expectedVersion: operation.stateVersion,
        currentStatus: operation.status,
        status: 'IN_PROGRESS',
      });
    }
  });
}

async function broadcastAttempt(
  deps: SubmitDeps,
  paymentId: string,
  attempt: TransactionAttemptRow,
): Promise<void> {
  if (attempt.state !== 'SIGNED' && attempt.state !== 'SUBMITTED') return;
  const isFirst = attempt.state === 'SIGNED';
  const raw = bufferToHex(attempt.rawSignedTransaction) as `0x02${string}`;
  try {
    await deps.publicClient.sendRawTransaction({ serializedTransaction: raw });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error);
    // "already known" / "nonce too low" mean the identical bytes (or a winning replacement) are
    // already in flight -- evidence the transaction MAY be accepted, not evidence it failed.
    if (
      !message.includes('already known') &&
      !message.includes('nonce too low') &&
      !message.includes('replacement transaction underpriced')
    ) {
      throw error;
    }
  }
  await withTransaction(deps.pool, async (client) => {
    await markBroadcast(client, { attemptId: attempt.id, isFirstBroadcast: isFirst });
    if (isFirst) {
      const payment = await getPaymentById(client, paymentId);
      if (payment && isExecutionStatusTransitionAllowed(payment.executionStatus, 'SUBMITTED')) {
        await updatePaymentState(client, {
          paymentId,
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
    }
  });
}

export async function handlePaymentSubmissionJob(
  deps: SubmitDeps,
  job: { id: string; leaseOwner: string; leaseVersion: bigint; payload: SubmitJobPayload },
): Promise<SubmitJobResult> {
  const bundle = await loadPaymentExecutionBundle(deps.pool, job.payload.intentId);
  if (!bundle)
    throw new Error(`handlePaymentSubmissionJob: intent ${job.payload.intentId} vanished`);

  await markOperationInProgress(deps, job.payload.operationId);

  // SPEC-035: an open nonce family means real on-chain authority (a reserved nonce, possibly
  // already signed or broadcast) already exists for this intent. That authority must be chased to
  // resolution BEFORE any retirement/policy check -- a legitimate re-versioning of this intent
  // (POST /v1/payment-intents creating N+1) or an owner pausing the policy can both land in the
  // window between broadcast and this invocation, and neither one makes a live transaction stop
  // being live. Checking `bundle.retired`/`bundle.policyObservedStatus` first would reject and
  // complete the job right here, permanently abandoning a SIGNED/SUBMITTED attempt that may still
  // mine -- funds would move on-chain with nothing left to ever reconcile it (CLAUDE.md: "Chain
  // observations determine fund movement and consumption").
  const openFamily = await getOpenNonceFamilyForIntent(deps.pool, bundle.intentId);
  if (openFamily) {
    const attempt = await getLatestAttemptForNonceFamily(deps.pool, openFamily.id);
    if (!attempt) {
      return { kind: 'RETRY', reason: 'nonce family reserved but not yet signed' };
    }
    await broadcastAttempt(deps, bundle.paymentId, attempt);
    return await pollAndReconcileFor(deps, bundle, job, openFamily.id, attempt);
  }

  // No open on-chain authority yet -- safe to reject the job before ever spending a nonce.
  if (bundle.retired) {
    await rejectPayment(deps, bundle, job, 'INTENT_RETIRED');
    return { kind: 'DONE' };
  }
  if (bundle.policyObservedStatus !== 'ACTIVE') {
    await rejectPayment(deps, bundle, job, `POLICY_${bundle.policyObservedStatus}`);
    return { kind: 'DONE' };
  }
  // SPEC-034: MISMATCH is sticky by design (ARCH 3.4: "a mismatch disables further automatic
  // execution ... it never triggers an automatic second payment"). Nothing in this codebase ever
  // clears it back through NOT_CHECKED, so a job reaching here for a MISMATCH-flagged payment can
  // only exist because the API layer queued it anyway (its own guard is best-effort, not the sole
  // enforcement point) -- refuse it here too, rather than silently attempting a fresh execution.
  const currentPayment = await getPaymentById(deps.pool, bundle.paymentId);
  if (currentPayment?.reconciliation === 'MISMATCH') {
    await rejectPayment(deps, bundle, job, 'RECONCILIATION_MISMATCH_STICKY');
    return { kind: 'DONE' };
  }

  const reader = createVaultReader({
    publicClient: deps.publicClient,
    vaultAddress: bundle.vaultAddress,
  });
  const signatures = buildSignatureSet(bundle);

  const evaluation = await reader.evaluate(bundle.invoice, bundle.intent, signatures);
  if (evaluation.decision === 'UNKNOWN') {
    return { kind: 'RETRY', reason: 'evaluate: chain state unknown' };
  }
  if (evaluation.decision === 'BLOCK') {
    await rejectPayment(deps, bundle, job, evaluation.reasonCode, 'BLOCK');
    return { kind: 'DONE' };
  }
  if (evaluation.decision === 'ESCALATE' && !bundle.approval) {
    await rejectPayment(deps, bundle, job, 'APPROVAL_REQUIRED', 'ESCALATE');
    return { kind: 'DONE' };
  }

  const prepared = prepareExecutePaymentCalldata({
    vaultAddress: bundle.vaultAddress,
    invoice: bundle.invoice,
    intent: bundle.intent,
    signatures,
  });
  const simulation = await reader.simulateExecutePayment({
    relayer: deps.signer.address,
    invoice: bundle.invoice,
    intent: bundle.intent,
    signatures,
  });
  if (!simulation.available) {
    if (simulation.infrastructureUnavailable) {
      return { kind: 'RETRY', reason: 'simulate: chain state unknown' };
    }
    await rejectPayment(
      deps,
      bundle,
      job,
      simulation.rejectedReason ?? 'SIMULATION_REJECTED',
      evaluation.decision,
    );
    return { kind: 'DONE' };
  }

  const { gas, maxFeePerGas, maxPriorityFeePerGas } = await estimateRelayerGasAndFees({
    publicClient: deps.publicClient,
    from: deps.signer.address,
    to: prepared.to,
    data: prepared.data,
  });

  // SPEC-037: refuse a FRESH nonce reservation while this signer has an unresolved gap left by a
  // reorg-orphaned attempt whose payment could not be safely resumed (already canonically settled
  // through a different attempt -- see `reconcileSignerNonceAfterReorg`). Reserving anyway would
  // allocate a nonce ABOVE the gap that the live chain will refuse until the gap nonce is filled,
  // silently growing the backlog instead of surfacing it. This is an RPC read, done here (before
  // opening the write transaction below), never inside one.
  const liveTransactionCount = BigInt(
    await deps.publicClient.getTransactionCount({
      address: deps.signer.address,
      blockTag: 'latest',
    }),
  );
  const gapUnresolved = await hasUnresolvedNonceGap(deps.pool, {
    deploymentId: bundle.deploymentId,
    sender: addressToBuffer(deps.signer.address),
    liveTransactionCount,
  });
  if (gapUnresolved) {
    return {
      kind: 'RETRY',
      reason: 'nonce gap unresolved for this signer (SPEC-037) -- blocked pending resolution',
    };
  }

  const { family, attempt } = await withTransaction(deps.pool, async (client) => {
    await lockSigner(client, {
      deploymentId: bundle.deploymentId,
      sender: addressToBuffer(deps.signer.address),
    });
    const family = await reserveNonceFamily(client, {
      id: randomUUID(),
      deploymentId: bundle.deploymentId,
      sender: addressToBuffer(deps.signer.address),
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
    const signed = await signRelayerTransaction(deps.signer, {
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

    // SPEC-030: QUEUED -> SIGNED, in the SAME transaction as recordSignedAttempt -- the public
    // executionStatus projection must never say SIGNED before the raw bytes are actually durable.
    const payment = await getPaymentById(client, bundle.paymentId);
    if (payment && isExecutionStatusTransitionAllowed(payment.executionStatus, 'SIGNED')) {
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

  await broadcastAttempt(deps, bundle.paymentId, attempt);
  return await pollAndReconcileFor(deps, bundle, job, family.id, attempt);
}

async function pollAndReconcileFor(
  deps: SubmitDeps,
  bundle: PaymentExecutionBundle,
  job: { id: string; leaseOwner: string; leaseVersion: bigint; payload: SubmitJobPayload },
  nonceFamilyId: string,
  attempt: TransactionAttemptRow,
): Promise<SubmitJobResult> {
  const expectation: PaymentExecutionExpectation = {
    expectedChainId: bundle.chainId.toString(10),
    expectedTo: bundle.vaultAddress,
    expectedFrom: deps.signer.address,
    expectedVault: bundle.vaultAddress,
    expectedIntentHash: bundle.intentDigest,
    expectedMerchant: bundle.invoice.recipient,
    expectedOutputToken: bundle.invoice.settlementToken,
    expectedExactOutput: bundle.invoice.outputAmount,
    expectedMaxInput: bundle.intent.maxInputAmount,
    expectedRouteId: bundle.intent.routeId,
  };

  for (let i = 0; i < deps.config.receiptPollAttempts; i++) {
    const result = await reconcileAttempt(
      { pool: deps.pool, publicClient: deps.publicClient },
      {
        deploymentId: bundle.deploymentId,
        paymentId: bundle.paymentId,
        operationId: job.payload.operationId,
        outboxJobId: job.id,
        leaseOwner: job.leaseOwner,
        leaseVersion: job.leaseVersion,
        attemptId: attempt.id,
        nonceFamilyId,
        txHash: bufferToHex(attempt.txHash),
        expectation,
      },
    );
    if (result.kind === 'SETTLED') return { kind: 'DONE' };
    await new Promise((resolve) => setTimeout(resolve, deps.config.receiptPollIntervalMs));
  }
  return { kind: 'RETRY', reason: 'receipt not yet observed within bounded wait' };
}
