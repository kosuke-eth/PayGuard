/**
 * EIP-712 business-object signature verification.
 *
 * The vault verifies the three signed objects ASYMMETRICALLY, and the API must mirror that exactly
 * or it will report a validity the chain disagrees with:
 *
 *   - Invoice and PaymentIntent -> `ECDSA.tryRecover` (PayGuardVault.sol:505-509). **EOA only.**
 *     If the API accepted an ERC-1271 invoice signature, it would report `signatureValid: true`
 *     for something `executePayment` will later reject -- a false claim about the chain.
 *   - ExceptionApproval -> `SignatureChecker.isValidSignatureNow(owner, ...)`
 *     (PayGuardVault.sol:499). **ERC-1271 capable.** If the API insisted on ECDSA here, it would
 *     reject a legitimate contract-wallet owner's approval the vault would have accepted.
 *
 * The approval's expected signer is the vault's LIVE on-chain `owner()`, not the
 * `vaults.owner_wallet_id` projection -- the database row is a cached observation, the contract is
 * the authority.
 */

import type { Hash32, HexBytes } from '@payguard/domain';
import { type Address, type Hex, type PublicClient, recoverAddress } from 'viem';

export type BusinessSignatureVerdict =
  | { kind: 'VALID'; recoveredSigner: Address; signerType: 'EOA' | 'ERC1271' }
  | { kind: 'INVALID'; recoveredSigner: Address | null; detail: string }
  | { kind: 'UNKNOWN'; detail: string };

/**
 * ECDSA-only recovery over a precomputed EIP-712 digest, matching the vault's invoice/intent path.
 * Returns the recovered address so callers can compare it to the policy-pinned `invoiceSigner` or
 * `agent` themselves -- recovery succeeding says nothing about authorization.
 */
export async function recoverTypedDataSigner(
  digest: Hash32,
  signature: HexBytes,
): Promise<Address | null> {
  try {
    return await recoverAddress({ hash: digest as Hex, signature: signature as Hex });
  } catch {
    return null;
  }
}

/** Invoice / PaymentIntent: EOA ECDSA only, exactly as the vault checks them. */
export async function verifyEoaTypedSignature(params: {
  digest: Hash32;
  signature: HexBytes;
  expectedSigner: Address;
}): Promise<BusinessSignatureVerdict> {
  const recovered = await recoverTypedDataSigner(params.digest, params.signature);
  if (recovered === null) {
    return { kind: 'INVALID', recoveredSigner: null, detail: 'signature is not recoverable' };
  }
  if (recovered.toLowerCase() !== params.expectedSigner.toLowerCase()) {
    return {
      kind: 'INVALID',
      recoveredSigner: recovered,
      detail: `recovered ${recovered}, expected ${params.expectedSigner}`,
    };
  }
  return { kind: 'VALID', recoveredSigner: recovered, signerType: 'EOA' };
}

const ERC1271_ABI = [
  {
    type: 'function',
    name: 'isValidSignature',
    stateMutability: 'view',
    inputs: [
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes4' }],
  },
] as const;

const ERC1271_MAGIC_VALUE = '0x1626ba7e';

/**
 * ExceptionApproval: ERC-1271-capable, matching `SignatureChecker`. Tries ECDSA first (no network
 * needed), then falls back to an on-chain `isValidSignature` call for contract owners.
 *
 * An RPC failure during the contract path yields UNKNOWN, never INVALID.
 */
export async function verifyOwnerApprovalSignature(params: {
  digest: Hash32;
  signature: HexBytes;
  /** The vault's live on-chain owner(), not a database projection. */
  ownerAddress: Address;
  publicClient: PublicClient | null;
}): Promise<BusinessSignatureVerdict> {
  const recovered = await recoverTypedDataSigner(params.digest, params.signature);
  if (recovered !== null && recovered.toLowerCase() === params.ownerAddress.toLowerCase()) {
    return { kind: 'VALID', recoveredSigner: recovered, signerType: 'EOA' };
  }

  if (!params.publicClient) {
    return {
      kind: 'UNKNOWN',
      detail: 'no chain client available for the ERC-1271 owner-approval check',
    };
  }

  let bytecode: Hex | undefined;
  try {
    bytecode = await params.publicClient.getCode({ address: params.ownerAddress });
  } catch (error) {
    return {
      kind: 'UNKNOWN',
      detail: `could not read owner account code: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!bytecode || bytecode === '0x') {
    // Owner is a plain EOA and ECDSA recovery already disagreed: a real invalid signature.
    return {
      kind: 'INVALID',
      recoveredSigner: recovered,
      detail: `owner is an EOA; recovered ${recovered ?? 'nothing'}, expected ${params.ownerAddress}`,
    };
  }

  try {
    const result = (await params.publicClient.readContract({
      address: params.ownerAddress,
      abi: ERC1271_ABI,
      functionName: 'isValidSignature',
      args: [params.digest as Hex, params.signature as Hex],
    })) as Hex;
    return result.toLowerCase() === ERC1271_MAGIC_VALUE
      ? { kind: 'VALID', recoveredSigner: params.ownerAddress, signerType: 'ERC1271' }
      : {
          kind: 'INVALID',
          recoveredSigner: recovered,
          detail: 'ERC-1271 isValidSignature did not return the magic value',
        };
  } catch (error) {
    return {
      kind: 'UNKNOWN',
      detail: `ERC-1271 call failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
