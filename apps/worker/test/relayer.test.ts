/**
 * Real local Anvil: sign a relayer transaction locally (no RPC during signing), broadcast the
 * persisted raw bytes, confirm it mines, and confirm `verifySignedRelayerTransaction` both accepts
 * the real signed bytes and rejects a tampered expectation -- proving the decode-back check
 * CLAUDE.md requires actually holds against a real signature, not just a hand-built fixture.
 */
import { createLocalPublicClient } from '@payguard/chain';
import { RELAYER_PRIVATE_KEY, type SpawnedAnvil, spawnAnvil } from '@payguard/test-utils';
import { keccak256, type PublicClient } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRelayerSigner,
  estimateRelayerGasAndFees,
  signRelayerTransaction,
  verifySignedRelayerTransaction,
} from '../src/relayer.js';

const PORT = 8551;
const CHAIN_ID = 31337;

let anvil: SpawnedAnvil;
let publicClient: PublicClient;

beforeAll(async () => {
  anvil = await spawnAnvil({ port: PORT, chainId: CHAIN_ID });
  publicClient = createLocalPublicClient({ rpcUrl: anvil.rpcUrl, chainId: CHAIN_ID });
}, 30_000);

afterAll(async () => {
  await anvil.stop();
});

describe('relayer signing against a real local Anvil', () => {
  it('signs locally, broadcasts, mines, and verifies the recovered bytes', async () => {
    const signer = createRelayerSigner(RELAYER_PRIVATE_KEY);
    const to = '0x000000000000000000000000000000000000dEaD' as const;
    const data = '0x' as const;

    const { gas, maxFeePerGas, maxPriorityFeePerGas } = await estimateRelayerGasAndFees({
      publicClient,
      from: signer.address,
      to,
      data,
    });
    const nonce = BigInt(await publicClient.getTransactionCount({ address: signer.address }));

    const signed = await signRelayerTransaction(signer, {
      chainId: CHAIN_ID,
      to,
      data,
      value: 0n,
      nonce,
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
    expect(signed.raw.startsWith('0x02')).toBe(true); // EIP-1559 typed transaction

    const valid = await verifySignedRelayerTransaction(signed.raw, {
      expectedChainId: CHAIN_ID,
      expectedFrom: signer.address,
      expectedTo: to,
      expectedCalldataHash: keccak256('0x'),
      expectedNonce: nonce,
    });
    expect(valid.valid).toBe(true);
    expect(valid.reasons).toEqual([]);

    const sentHash = await publicClient.sendRawTransaction({ serializedTransaction: signed.raw });
    expect(sentHash.toLowerCase()).toBe(signed.hash.toLowerCase());
    const receipt = await publicClient.waitForTransactionReceipt({ hash: sentHash });
    expect(receipt.status).toBe('success');
  }, 20_000);

  it('rejects verification against a wrong expected nonce/destination/calldata', async () => {
    const signer = createRelayerSigner(RELAYER_PRIVATE_KEY);
    const nonce = BigInt(await publicClient.getTransactionCount({ address: signer.address }));
    const to = '0x000000000000000000000000000000000000dEaD' as const;
    const { gas, maxFeePerGas, maxPriorityFeePerGas } = await estimateRelayerGasAndFees({
      publicClient,
      from: signer.address,
      to,
      data: '0x',
    });
    const signed = await signRelayerTransaction(signer, {
      chainId: CHAIN_ID,
      to,
      data: '0x',
      value: 0n,
      nonce,
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });

    const wrongNonce = await verifySignedRelayerTransaction(signed.raw, {
      expectedChainId: CHAIN_ID,
      expectedFrom: signer.address,
      expectedTo: to,
      expectedCalldataHash: keccak256('0x'),
      expectedNonce: nonce + 1n,
    });
    expect(wrongNonce.valid).toBe(false);
    expect(wrongNonce.reasons.some((r) => r.includes('nonce mismatch'))).toBe(true);

    const wrongTo = await verifySignedRelayerTransaction(signed.raw, {
      expectedChainId: CHAIN_ID,
      expectedFrom: signer.address,
      expectedTo: '0x0000000000000000000000000000000000beef',
      expectedCalldataHash: keccak256('0x'),
      expectedNonce: nonce,
    });
    expect(wrongTo.valid).toBe(false);
    expect(wrongTo.reasons.some((r) => r.includes('to mismatch'))).toBe(true);
  }, 20_000);
});
