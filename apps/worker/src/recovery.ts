/**
 * Startup recovery: the two crash windows that must never wait on an outbox lease timeout to
 * resolve (recovery table rows 3-5).
 *
 *  1. Nonce allocated, never signed -- `lockSigner` + `recoverUnsignedFamilies` inside ONE
 *     transaction (Stage 5 recovery-table review finding 1: the lock must cover BOTH the read and
 *     the resulting `recordSignedAttempt`, not just allocation, or two recovering workers can
 *     double-sign the same family).
 *  2. Signed, never broadcast -- rebroadcast the exact persisted raw bytes; never re-sign.
 *
 * Both run once at worker boot, before the outbox loop starts claiming jobs. A SUBMITTED/UNKNOWN
 * attempt needs no separate recovery step here: `submitPayment.ts`'s "resume vs fresh" check
 * handles it uniformly whether the job was just claimed for the first time or reclaimed after a
 * crash.
 */
import { randomUUID } from 'node:crypto';
import {
  getSignedNotBroadcastAttempts,
  lockSigner,
  recordSignedAttempt,
  recoverUnsignedFamilies,
  withTransaction,
} from '@payguard/db';
import type { Address, Hash32 } from '@payguard/domain';
import type pg from 'pg';
import type { PublicClient } from 'viem';
import { addressToBuffer, bufferToHex, hexToBuffer } from './encoding.js';
import type { RelayerSigner } from './relayer.js';
import { signRelayerTransaction, verifySignedRelayerTransaction } from './relayer.js';

interface StoredUnsignedRequest {
  to: Address;
  data: `0x${string}`;
  value: string;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  chainId: number;
  calldataHash: Hash32;
}

export interface RecoveryDeps {
  pool: pg.Pool;
  publicClient: PublicClient;
  signer: RelayerSigner;
  deploymentId: string;
}

export interface RecoveryReport {
  signedRecoveredCount: number;
  rebroadcastCount: number;
}

async function recoverUnsignedFamiliesAtStartup(deps: RecoveryDeps): Promise<number> {
  let recoveredCount = 0;
  await withTransaction(deps.pool, async (client) => {
    await lockSigner(client, {
      deploymentId: deps.deploymentId,
      sender: addressToBuffer(deps.signer.address),
    });
    const unsigned = await recoverUnsignedFamilies(client, {
      deploymentId: deps.deploymentId,
      sender: addressToBuffer(deps.signer.address),
    });
    for (const family of unsigned) {
      const req = family.unsignedRequest as StoredUnsignedRequest;
      const signed = await signRelayerTransaction(deps.signer, {
        chainId: req.chainId,
        to: req.to,
        data: req.data,
        value: BigInt(req.value),
        nonce: family.nonce,
        gas: BigInt(req.gas),
        maxFeePerGas: BigInt(req.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(req.maxPriorityFeePerGas),
      });
      const verification = await verifySignedRelayerTransaction(signed.raw, {
        expectedChainId: req.chainId,
        expectedFrom: deps.signer.address,
        expectedTo: req.to,
        expectedCalldataHash: req.calldataHash,
        expectedNonce: family.nonce,
      });
      if (!verification.valid) {
        throw new Error(
          `recoverUnsignedFamiliesAtStartup: recovered signature for family ${family.id} failed verification: ${verification.reasons.join('; ')}`,
        );
      }
      await recordSignedAttempt(client, {
        id: randomUUID(),
        deploymentId: deps.deploymentId,
        nonceFamilyId: family.id,
        txHash: hexToBuffer(signed.hash),
        rawSignedTransaction: hexToBuffer(signed.raw),
      });
      recoveredCount++;
    }
  });
  return recoveredCount;
}

async function rebroadcastSignedNotBroadcastAtStartup(deps: RecoveryDeps): Promise<number> {
  const pending = await getSignedNotBroadcastAttempts(deps.pool, {
    deploymentId: deps.deploymentId,
  });
  let rebroadcastCount = 0;
  for (const attempt of pending) {
    const raw = bufferToHex(attempt.rawSignedTransaction) as `0x02${string}`;
    try {
      await deps.publicClient.sendRawTransaction({ serializedTransaction: raw });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error);
      if (
        !message.includes('already known') &&
        !message.includes('nonce too low') &&
        !message.includes('replacement transaction underpriced')
      ) {
        throw error;
      }
    }
    rebroadcastCount++;
  }
  // markBroadcast happens per-attempt inside submitPayment.ts's normal "resume" path the next
  // time each intent's job is claimed -- rebroadcasting here only guarantees the bytes are back in
  // the mempool immediately at boot, it does not itself need to own the state transition.
  return rebroadcastCount;
}

export async function runStartupRecovery(deps: RecoveryDeps): Promise<RecoveryReport> {
  const signedRecoveredCount = await recoverUnsignedFamiliesAtStartup(deps);
  const rebroadcastCount = await rebroadcastSignedNotBroadcastAtStartup(deps);
  return { signedRecoveredCount, rebroadcastCount };
}
