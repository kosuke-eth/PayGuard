/**
 * Bounded `eth_getLogs` polling for the deployed vault, with reorg detection/regression (item 5).
 * Complements `reconcile.ts`'s per-attempt receipt polling (which already persists blocks/receipts
 * /events for transactions THIS worker itself submitted): the indexer's job is broader passive
 * observation -- events from transactions the worker did not itself broadcast (owner policy
 * transactions, a manually-submitted payment) and, critically, detecting when a previously-seen
 * canonical block stops being canonical.
 *
 * One cursor per (deployment, contract group), CAS-advanced (`advanceCursor`) so a partial/failed
 * range fetch never silently loses progress -- the cursor simply doesn't move and the next tick
 * retries the same window (ARCH 3.4: "On partial RPC range failure, retain the old cursor").
 */

import { PAYGUARD_VAULT_ABI } from '@payguard/chain';
import {
  advanceCursor,
  getCanonicalBlockAtHeight,
  getCursor,
  getMaxCanonicalBlock,
  getPaymentById,
  getPaymentsAffectedByOrphanedBlocks,
  isReconciliationTransitionAllowed,
  recordBlock,
  recordEvent,
  reorgToBlock,
  updatePaymentState,
  withTransaction,
} from '@payguard/db';
import type { Address } from '@payguard/domain';
import type pg from 'pg';
import type { PublicClient } from 'viem';
import { decodeEventLog, type Log } from 'viem';
import { hexToBuffer, toJsonSafe } from './encoding.js';

const CONTRACT_GROUP = 'vault';

export interface IndexerDeps {
  pool: pg.Pool;
  publicClient: PublicClient;
  deploymentId: string;
  vaultAddress: Address;
  startBlock: bigint;
  batchBlocks: bigint;
}

function decodeLog(log: Log): { eventName: string; args: Record<string, unknown> } | null {
  try {
    const decoded = decodeEventLog({ abi: PAYGUARD_VAULT_ABI, data: log.data, topics: log.topics });
    return {
      eventName: decoded.eventName as string,
      args: (decoded.args ?? {}) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

/**
 * Regresses every payment whose winning attempt lived in an orphaned block. Runs BEFORE
 * `reorgToBlock` flips canonicality, in the SAME transaction, using the pre-flip block set.
 */
async function regressAffectedPayments(
  client: pg.PoolClient,
  params: { deploymentId: string; orphanedBlockHashes: Buffer[] },
): Promise<void> {
  const affected = await getPaymentsAffectedByOrphanedBlocks(client, params);
  for (const { paymentId } of affected) {
    const payment = await getPaymentById(client, paymentId);
    if (!payment) continue;
    if (
      payment.executionStatus === 'INCLUDED' ||
      payment.executionStatus === 'SUCCEEDED' ||
      payment.executionStatus === 'REVERTED'
    ) {
      const reorged = await updatePaymentState(client, {
        paymentId,
        expectedVersion: payment.stateVersion,
        current: {
          policyDecision: payment.policyDecision,
          executionStatus: payment.executionStatus,
          confidence: payment.confidence,
          reconciliation: payment.reconciliation,
        },
        next: { executionStatus: 'REORGED', confidence: 'UNOBSERVED' },
      });
      if (reorged.row) {
        // SPEC-034: the orphaned receipt this reconciliation was based on no longer exists on the
        // canonical chain -- a stale MATCHED/MISMATCH verdict from it must not survive the
        // regression (RECONCILIATION_GRAPH only lets MATCHED/MISMATCH resolve back through
        // NOT_CHECKED explicitly; it is never automatically silently kept).
        const resetReconciliation = isReconciliationTransitionAllowed(
          reorged.row.reconciliation,
          'NOT_CHECKED',
        );
        await updatePaymentState(client, {
          paymentId,
          expectedVersion: reorged.row.stateVersion,
          current: {
            policyDecision: reorged.row.policyDecision,
            executionStatus: 'REORGED',
            confidence: 'UNOBSERVED',
            reconciliation: reorged.row.reconciliation,
          },
          next: {
            executionStatus: 'UNKNOWN',
            reasonCode: 'ORPHANED_BLOCK',
            ...(resetReconciliation ? { reconciliation: 'NOT_CHECKED' } : {}),
          },
        });
      }
    }
  }
}

/**
 * Walks back from the cursor's last-seen (now-diverged) height, one block at a time, comparing the
 * LIVE chain's block hash at each height against the block WE stored as canonical at that same
 * height -- not merely stepping back once and assuming that is the ancestor. Every height where the
 * two disagree is orphaned; the walk stops (and reports the ancestor) at the first height where they
 * agree, or falls back to `deps.startBlock` if no agreement is found within the bound.
 */
async function findCommonAncestorAndOrphans(
  deps: IndexerDeps,
  storedHash: Buffer,
  storedNumber: bigint,
): Promise<{ orphaned: Buffer[]; ancestorNumber: bigint }> {
  const orphaned: Buffer[] = [storedHash];
  let n = storedNumber;
  // Bounded walk-back: LOCAL_DEMO reorgs are shallow; a real deployment would cap this generously
  // but never unboundedly.
  for (let i = 0; i < 64 && n > deps.startBlock; i++) {
    n -= 1n;
    const [chainBlock, ourBlock] = await Promise.all([
      deps.publicClient.getBlock({ blockNumber: n }),
      getCanonicalBlockAtHeight(deps.pool, { deploymentId: deps.deploymentId, blockNumber: n }),
    ]);
    const ourHashHex = ourBlock ? `0x${ourBlock.blockHash.toString('hex')}`.toLowerCase() : null;
    if (ourHashHex && chainBlock.hash.toLowerCase() === ourHashHex) {
      return { orphaned, ancestorNumber: n };
    }
    // We stored a DIFFERENT block at this height (or never stored one and can't confirm agreement
    // either way) -- if we have one, it is orphaned too; keep walking back regardless.
    if (ourBlock) orphaned.push(ourBlock.blockHash);
  }
  return { orphaned, ancestorNumber: deps.startBlock };
}

export async function runIndexerTick(
  deps: IndexerDeps,
): Promise<{ processedThrough: bigint | null }> {
  const latest = await deps.publicClient.getBlockNumber();
  const cursor = await getCursor(deps.pool, {
    deploymentId: deps.deploymentId,
    contractGroup: CONTRACT_GROUP,
  });
  const fromBlock = cursor?.nextBlock ?? deps.startBlock;
  const leaseVersion = cursor?.leaseVersion ?? 0n;

  // SPEC-034: anchor reorg detection to the highest canonical block WE have recorded from ANY
  // writer, not just the indexer's own cursor frontier -- `reconcileAttempt` writes a canonical
  // block synchronously at a settlement's exact height, which can sit ahead of the indexer's own
  // last-scanned height. The indexer's own frontier is always <= this, so this check subsumes the
  // plain cursor-based one and additionally catches a reorg at one of those out-of-band-ahead
  // heights that the old cursor-only check could never see.
  const maxKnown = await getMaxCanonicalBlock(deps.pool, { deploymentId: deps.deploymentId });
  if (maxKnown && maxKnown.blockNumber >= deps.startBlock) {
    const chainBlock = await deps.publicClient.getBlock({ blockNumber: maxKnown.blockNumber });
    if (chainBlock.hash.toLowerCase() !== `0x${maxKnown.blockHash.toString('hex')}`.toLowerCase()) {
      const { orphaned, ancestorNumber } = await findCommonAncestorAndOrphans(
        deps,
        maxKnown.blockHash,
        maxKnown.blockNumber,
      );
      const newCanonical = await deps.publicClient.getBlock({ blockNumber: ancestorNumber });
      await withTransaction(deps.pool, async (client) => {
        await regressAffectedPayments(client, {
          deploymentId: deps.deploymentId,
          orphanedBlockHashes: orphaned,
        });
        await reorgToBlock(client, {
          deploymentId: deps.deploymentId,
          orphanedBlockHashes: orphaned,
          newCanonicalBlockHash: hexToBuffer(newCanonical.hash),
        });
        await advanceCursor(client, {
          deploymentId: deps.deploymentId,
          contractGroup: CONTRACT_GROUP,
          nextBlock: ancestorNumber + 1n,
          lastCanonicalHash: hexToBuffer(newCanonical.hash),
          expectedLeaseVersion: leaseVersion,
        });
      });
      return { processedThrough: null }; // let the next tick resume forward from the corrected cursor
    }
  }

  if (fromBlock > latest) return { processedThrough: null };
  const toBlock =
    fromBlock + deps.batchBlocks - 1n > latest ? latest : fromBlock + deps.batchBlocks - 1n;

  const logs = await deps.publicClient.getLogs({
    address: deps.vaultAddress,
    fromBlock,
    toBlock,
  });

  const blockHashes = [
    ...new Set(logs.map((l) => l.blockHash).filter((h): h is `0x${string}` => h !== null)),
  ];
  const blocks = await Promise.all(
    blockHashes.map((hash) => deps.publicClient.getBlock({ blockHash: hash })),
  );
  const tailBlock =
    blocks.find((b) => b.number === toBlock) ??
    (await deps.publicClient.getBlock({ blockNumber: toBlock }));

  await withTransaction(deps.pool, async (client) => {
    for (const block of blocks) {
      await recordBlock(client, {
        deploymentId: deps.deploymentId,
        blockHash: hexToBuffer(block.hash),
        blockNumber: block.number,
        parentHash: hexToBuffer(block.parentHash),
        canonical: true,
        confidence: 'LOCAL_DEMO',
      });
    }
    if (!blocks.some((b) => b.hash === tailBlock.hash)) {
      await recordBlock(client, {
        deploymentId: deps.deploymentId,
        blockHash: hexToBuffer(tailBlock.hash),
        blockNumber: tailBlock.number,
        parentHash: hexToBuffer(tailBlock.parentHash),
        canonical: true,
        confidence: 'LOCAL_DEMO',
      });
    }
    for (const log of logs) {
      if (log.blockHash === null || log.transactionHash === null) continue;
      const decoded = decodeLog(log);
      await recordEvent(client, {
        deploymentId: deps.deploymentId,
        blockHash: hexToBuffer(log.blockHash),
        logIndex: BigInt(log.logIndex ?? 0),
        txHash: hexToBuffer(log.transactionHash),
        emitter: hexToBuffer(log.address),
        topic0: hexToBuffer(log.topics[0] ?? '0x'),
        topics: log.topics,
        data: hexToBuffer(log.data),
        ...(decoded
          ? { decodedName: decoded.eventName, decodedPayload: toJsonSafe(decoded.args) }
          : {}),
        canonical: true,
      });
    }
    const advanced = await advanceCursor(client, {
      deploymentId: deps.deploymentId,
      contractGroup: CONTRACT_GROUP,
      nextBlock: toBlock + 1n,
      lastCanonicalHash: hexToBuffer(tailBlock.hash),
      expectedLeaseVersion: leaseVersion,
    });
    if (!advanced.updated) {
      throw new Error('runIndexerTick: cursor advanced concurrently by another process');
    }
  });

  return { processedThrough: toBlock };
}
