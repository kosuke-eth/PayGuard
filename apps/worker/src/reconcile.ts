/**
 * Turns an observed receipt into the atomic projection commit ARCH 3.4/CLAUDE.md require: block +
 * receipt + every raw log persisted, the winning attempt closed, its losing siblings marked
 * REPLACED, the payment's executionStatus/confidence/reconciliation updated from ACTUAL decoded
 * evidence (never from the bare fact that "a" receipt succeeded), the operation completed, and the
 * originating outbox job completed -- all in ONE Postgres transaction (recovery table row 8/8a).
 *
 * Three distinct outcomes, matching CLAUDE.md's own three cases:
 *  - not yet mined                                  -> PENDING (caller requeues the outbox job)
 *  - mined and reverted                              -> REVERTED (gas/nonce spent, invoice NOT consumed)
 *  - mined, succeeded, but decoded evidence disagrees -> UNKNOWN + MISMATCH (never a fabricated SUCCEEDED --
 *    "a successful transaction receipt for a different contract ... is not a PayGuard payment success")
 *  - mined, succeeded, evidence matches               -> SUCCEEDED + MATCHED
 */
import { randomUUID } from 'node:crypto';
import {
  decodeVaultEvents,
  type PaymentExecutionExpectation,
  validatePaymentExecution,
} from '@payguard/chain';
import {
  attachCanonicalReceipt,
  completeJob,
  completeSingleTransactionOperation,
  getOperationById,
  getPaymentById,
  insertTimelineEvent,
  markSiblingAttemptsReplaced,
  type PaymentRow,
  recordBlock,
  recordEvent,
  recordReceipt,
  updatePaymentState,
  withTransaction,
} from '@payguard/db';
import type { Address, Hash32 } from '@payguard/domain';
import type pg from 'pg';
import type { PublicClient } from 'viem';
import { hexToBuffer, toJsonSafe } from './encoding.js';

export type ReconcileResult =
  | { kind: 'PENDING' }
  | { kind: 'SETTLED'; success: boolean; reasonCode: string | null };

export async function reconcileAttempt(
  deps: { pool: pg.Pool; publicClient: PublicClient },
  params: {
    deploymentId: string;
    paymentId: string;
    operationId: string;
    outboxJobId: string;
    leaseOwner: string;
    leaseVersion: bigint;
    attemptId: string;
    nonceFamilyId: string;
    txHash: Hash32;
    expectation: PaymentExecutionExpectation;
  },
): Promise<ReconcileResult> {
  const receipt = await deps.publicClient
    .getTransactionReceipt({ hash: params.txHash })
    .catch(() => null);
  if (!receipt) return { kind: 'PENDING' };

  const [block, transaction] = await Promise.all([
    deps.publicClient.getBlock({ blockHash: receipt.blockHash }),
    deps.publicClient.getTransaction({ hash: params.txHash }),
  ]);

  const transactionLike = {
    from: transaction.from,
    to: transaction.to,
    input: transaction.input,
    ...(transaction.chainId !== undefined ? { chainId: transaction.chainId } : {}),
  };
  const validation =
    receipt.status === 'success'
      ? validatePaymentExecution(receipt, transactionLike, params.expectation)
      : null;
  const decodedEvents = decodeVaultEvents(receipt, params.expectation.expectedVault);

  let reasonCode: string | null = null;
  let executionStatus: 'REVERTED' | 'SUCCEEDED' | 'UNKNOWN';
  let reconciliation: 'MATCHED' | 'MISMATCH' | undefined;
  let attemptState: 'REVERTED' | 'SUCCEEDED';
  let success: boolean;

  if (receipt.status === 'reverted') {
    executionStatus = 'REVERTED';
    attemptState = 'REVERTED';
    success = false;
  } else if (validation?.valid) {
    executionStatus = 'SUCCEEDED';
    attemptState = 'SUCCEEDED';
    reconciliation = 'MATCHED';
    success = true;
  } else {
    // Receipt succeeded on-chain but decoded evidence does not match the authorized intent --
    // NEVER report this as a payment success. The chain fact (this attempt succeeded) is still
    // recorded accurately; the business-level judgement is what stays cautious.
    executionStatus = 'UNKNOWN';
    attemptState = 'SUCCEEDED';
    reconciliation = 'MISMATCH';
    reasonCode = `RECONCILIATION_MISMATCH:${validation?.failed.map((f) => f.name).join(',')}`;
    success = false;
  }

  await withTransaction(deps.pool, async (client) => {
    await recordBlock(client, {
      deploymentId: params.deploymentId,
      blockHash: hexToBuffer(receipt.blockHash),
      blockNumber: receipt.blockNumber,
      parentHash: hexToBuffer(block.parentHash),
      canonical: true,
      confidence: 'LOCAL_DEMO',
    });
    await recordReceipt(client, {
      deploymentId: params.deploymentId,
      txHash: hexToBuffer(params.txHash),
      blockHash: hexToBuffer(receipt.blockHash),
      receiptStatus: receipt.status === 'success' ? 1 : 0,
      canonical: true,
      rawReceipt: toJsonSafe(receipt),
    });
    for (const log of receipt.logs) {
      const logIndex = BigInt(log.logIndex ?? 0);
      const decoded = decodedEvents.find((e) => BigInt(e.logIndex) === logIndex);
      await recordEvent(client, {
        deploymentId: params.deploymentId,
        blockHash: hexToBuffer(receipt.blockHash),
        logIndex,
        txHash: hexToBuffer(params.txHash),
        emitter: hexToBuffer(log.address as Address),
        topic0: hexToBuffer((log.topics[0] ?? '0x') as Hash32),
        topics: log.topics,
        data: hexToBuffer(log.data ?? '0x'),
        ...(decoded
          ? { decodedName: decoded.eventName, decodedPayload: toJsonSafe(decoded.args) }
          : {}),
        canonical: true,
      });
    }

    await attachCanonicalReceipt(client, {
      attemptId: params.attemptId,
      nonceFamilyId: params.nonceFamilyId,
      txHash: hexToBuffer(params.txHash),
      state: attemptState,
    });
    await markSiblingAttemptsReplaced(client, {
      nonceFamilyId: params.nonceFamilyId,
      winningAttemptId: params.attemptId,
    });

    const payment = await getPaymentById(client, params.paymentId);
    if (!payment) throw new Error(`reconcileAttempt: payment ${params.paymentId} vanished`);
    const updated = await updatePaymentStateFor(client, payment, {
      executionStatus,
      confidence: 'LOCAL_DEMO',
      reasonCode,
      ...(reconciliation !== undefined ? { reconciliation } : {}),
      ...(success ? { observedBlockHash: hexToBuffer(receipt.blockHash) } : {}),
    });
    if (!updated) {
      throw new Error(
        `reconcileAttempt: payment ${params.paymentId} state changed concurrently -- refusing to guess`,
      );
    }

    const operation = await getOperationById(client, params.operationId);
    if (operation) {
      await completeSingleTransactionOperation(client, {
        operationId: params.operationId,
        expectedVersion: operation.stateVersion,
        currentStatus: operation.status,
        status: success ? 'COMPLETED' : 'FAILED',
        transactionHash: hexToBuffer(params.txHash),
      });
    }

    await insertTimelineEvent(client, {
      id: randomUUID(),
      paymentId: params.paymentId,
      eventKey: `reconcile:${params.attemptId}:${params.txHash}`,
      eventType: success ? 'PAYMENT_SUCCEEDED' : `PAYMENT_${executionStatus}`,
      body: { txHash: params.txHash, reasonCode, blockHash: receipt.blockHash },
    });

    await completeJob(client, {
      id: params.outboxJobId,
      leaseOwner: params.leaseOwner,
      expectedLeaseVersion: params.leaseVersion,
    });
  });

  return { kind: 'SETTLED', success, reasonCode };
}

/**
 * Thin wrapper so the disjoint-optional-field discipline (`exactOptionalPropertyTypes`) lives in
 * one place instead of being hand-built at every call site.
 */
async function updatePaymentStateFor(
  client: pg.PoolClient,
  payment: PaymentRow,
  next: {
    executionStatus: 'REVERTED' | 'SUCCEEDED' | 'UNKNOWN';
    confidence: 'LOCAL_DEMO';
    reconciliation?: 'MATCHED' | 'MISMATCH';
    reasonCode: string | null;
    observedBlockHash?: Buffer;
  },
): Promise<boolean> {
  const result = await updatePaymentState(client, {
    paymentId: payment.id,
    expectedVersion: payment.stateVersion,
    current: {
      policyDecision: payment.policyDecision,
      executionStatus: payment.executionStatus,
      confidence: payment.confidence,
      reconciliation: payment.reconciliation,
    },
    next: {
      executionStatus: next.executionStatus,
      confidence: next.confidence,
      reasonCode: next.reasonCode,
      ...(next.reconciliation !== undefined ? { reconciliation: next.reconciliation } : {}),
      ...(next.observedBlockHash !== undefined
        ? { observedBlockHash: next.observedBlockHash }
        : {}),
    },
  });
  return result.updated;
}
