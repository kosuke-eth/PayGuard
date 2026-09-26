/**
 * Relayer local signing: build and sign the outer `executePayment` transaction with NO RPC call
 * (signing is pure local ECDSA over the serialized transaction) and NO broadcast. The worker
 * persists the resulting raw bytes/hash BEFORE ever calling `eth_sendRawTransaction` (Stage 5
 * recovery table rows 3/4) -- this module is deliberately incapable of sending anything itself,
 * so that ordering can never be violated by accident.
 *
 * `verifySignedRelayerTransaction` is the decode-back check CLAUDE.md requires: "Verify decoding
 * the signed transaction produces the stored chain/sender/nonce/permitted executePayment bytes" --
 * used both right after signing and again when recovering a persisted `SIGNED` row from a crash.
 */
import type { Hash32 } from '@payguard/domain';
import type { Address, Hex, PublicClient } from 'viem';
import { keccak256, parseTransaction, recoverTransactionAddress } from 'viem';
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts';

export interface RelayerSigner {
  address: Address;
  account: PrivateKeyAccount;
}

export function createRelayerSigner(privateKey: Hex): RelayerSigner {
  const account = privateKeyToAccount(privateKey);
  return { address: account.address, account };
}

export interface UnsignedRelayerRequest {
  chainId: number;
  to: Address;
  data: Hex;
  value: bigint;
  nonce: bigint;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface SignedRelayerTransaction {
  raw: Hex;
  hash: Hash32;
}

/** Local-only: no RPC call happens inside this function. */
export async function signRelayerTransaction(
  signer: RelayerSigner,
  request: UnsignedRelayerRequest,
): Promise<SignedRelayerTransaction> {
  const raw = await signer.account.signTransaction({
    chainId: request.chainId,
    to: request.to,
    data: request.data,
    value: request.value,
    nonce: Number(request.nonce),
    gas: request.gas,
    maxFeePerGas: request.maxFeePerGas,
    maxPriorityFeePerGas: request.maxPriorityFeePerGas,
    type: 'eip1559',
  });
  return { raw, hash: keccak256(raw) as Hash32 };
}

/** Two read-only `eth_call`-class estimates, deliberately kept OUTSIDE any DB transaction. */
export async function estimateRelayerGasAndFees(params: {
  publicClient: PublicClient;
  from: Address;
  to: Address;
  data: Hex;
}): Promise<{ gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const [gas, fees] = await Promise.all([
    params.publicClient.estimateGas({ account: params.from, to: params.to, data: params.data }),
    params.publicClient.estimateFeesPerGas(),
  ]);
  return { gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
}

export interface VerifyExpectation {
  expectedChainId: number;
  expectedFrom: Address;
  expectedTo: Address;
  expectedCalldataHash: Hash32;
  expectedNonce: bigint;
}

export interface VerifyResult {
  valid: boolean;
  reasons: string[];
}

/**
 * Decodes raw signed bytes and confirms chain/sender/nonce/destination/calldata all match what
 * was supposed to be signed -- never trusts a persisted or recovered blob on its own say-so.
 */
export async function verifySignedRelayerTransaction(
  raw: Hex,
  expectation: VerifyExpectation,
): Promise<VerifyResult> {
  const reasons: string[] = [];
  // Every relayer transaction this worker signs is EIP-1559 (type 2); the cast reflects that
  // fixed invariant, not an unchecked widening of an arbitrary caller-supplied blob.
  const parsed = parseTransaction(raw as `0x02${string}`);
  const sender = await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` });

  if (parsed.chainId !== expectation.expectedChainId) {
    reasons.push(
      `chainId mismatch: observed=${parsed.chainId} expected=${expectation.expectedChainId}`,
    );
  }
  if (sender.toLowerCase() !== expectation.expectedFrom.toLowerCase()) {
    reasons.push(`sender mismatch: observed=${sender} expected=${expectation.expectedFrom}`);
  }
  if ((parsed.to ?? '').toLowerCase() !== expectation.expectedTo.toLowerCase()) {
    reasons.push(`to mismatch: observed=${parsed.to} expected=${expectation.expectedTo}`);
  }
  if (parsed.nonce === undefined || BigInt(parsed.nonce) !== expectation.expectedNonce) {
    reasons.push(`nonce mismatch: observed=${parsed.nonce} expected=${expectation.expectedNonce}`);
  }
  const calldataHash = keccak256(parsed.data ?? '0x');
  if (calldataHash.toLowerCase() !== expectation.expectedCalldataHash.toLowerCase()) {
    reasons.push(
      `calldata mismatch: observed=${calldataHash} expected=${expectation.expectedCalldataHash}`,
    );
  }

  return { valid: reasons.length === 0, reasons };
}
