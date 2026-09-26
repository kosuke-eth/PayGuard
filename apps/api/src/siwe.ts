/**
 * SIWE (EIP-4361) challenge construction and verification.
 *
 * The server builds the COMPLETE message and stores it. Verification loads that stored message and
 * never accepts a caller-supplied replacement -- otherwise a caller could sign a message with a
 * domain, chain or expiry of their own choosing and present it as proof.
 *
 * Signature checking distinguishes three outcomes, not two:
 *   - valid signature
 *   - definitively invalid signature
 *   - the node could not tell us (ERC-1271 needs a chain read)
 * The third is `CHAIN_STATE_UNKNOWN`, never "invalid". Treating an RPC outage as a failed
 * signature would lock out a legitimate smart-contract-wallet owner and would be a false negative
 * of exactly the kind CLAUDE.md forbids ("An unavailable RPC when a contract-signature check is
 * needed is an infrastructure-unknown result, not proof that a signature is invalid").
 */
import { type Address, type Hex, type PublicClient, verifyMessage } from 'viem';
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from 'viem/siwe';
import { ApiError } from './errors.js';

export interface BuildChallengeParams {
  address: Address;
  chainId: bigint;
  domain: string;
  uri: string;
  sessionKind: 'BROWSER' | 'AGENT';
  issuedAt: Date;
  expiresAt: Date;
}

export interface BuiltChallenge {
  message: string;
  nonce: string;
}

/**
 * The statement names the session kind so the human signing it can see which credential they are
 * authorizing. The authoritative `sessionKind` is still the one stored on the challenge row
 * (SPEC-004) -- this text is for the signer's benefit, not an input to verification.
 */
export function buildChallenge(params: BuildChallengeParams): BuiltChallenge {
  const nonce = generateSiweNonce();
  const message = createSiweMessage({
    address: params.address,
    chainId: Number(params.chainId),
    domain: params.domain,
    nonce,
    uri: params.uri,
    version: '1',
    issuedAt: params.issuedAt,
    expirationTime: params.expiresAt,
    statement:
      params.sessionKind === 'BROWSER'
        ? 'Sign in to PayGuard (browser session). This authorizes API access only and moves no funds.'
        : 'Sign in to PayGuard (agent session). This authorizes API access only and moves no funds.',
  });
  return { message, nonce };
}

export interface ExpectedChallengeFields {
  address: Address;
  chainId: bigint;
  domain: string;
  uri: string;
  now: Date;
}

/**
 * Re-validates the STORED message's own fields before any signature work. A mismatch here means
 * the stored message is not the one this session is allowed to establish, so the signature is
 * irrelevant.
 */
export function assertChallengeFields(message: string, expected: ExpectedChallengeFields): void {
  const parsed = parseSiweMessage(message);

  if (!parsed.address || parsed.address.toLowerCase() !== expected.address.toLowerCase()) {
    throw new ApiError('INVALID_SESSION', 'challenge address does not match the presented address');
  }
  if (parsed.chainId === undefined || BigInt(parsed.chainId) !== expected.chainId) {
    throw new ApiError('INVALID_SESSION', 'challenge chainId does not match the expected chain');
  }
  if (parsed.domain !== expected.domain) {
    throw new ApiError('INVALID_SESSION', 'challenge domain does not match this server');
  }
  if (parsed.uri !== expected.uri) {
    throw new ApiError('INVALID_SESSION', 'challenge URI does not match this server');
  }
  if (parsed.expirationTime && parsed.expirationTime.getTime() <= expected.now.getTime()) {
    throw new ApiError('INVALID_SESSION', 'challenge has expired');
  }
  if (parsed.notBefore && parsed.notBefore.getTime() > expected.now.getTime()) {
    throw new ApiError('INVALID_SESSION', 'challenge is not yet valid');
  }
}

export type SignatureVerdict =
  | { kind: 'VALID'; signerType: 'EOA' | 'ERC1271' }
  | { kind: 'INVALID' }
  /** The node could not answer an ERC-1271 check. NOT a statement about the signature. */
  | { kind: 'UNKNOWN'; detail: string };

/**
 * Supported signer types, documented explicitly as the stage requires:
 *   - **EOA** (secp256k1 `personal_sign` recovery) -- verified offline, no RPC needed.
 *   - **ERC-1271 contract accounts** -- verified by calling `isValidSignature` on chain.
 * Anything else is unsupported and reports INVALID rather than being silently accepted.
 */
export async function verifySiweSignature(params: {
  message: string;
  signature: Hex;
  address: Address;
  publicClient: PublicClient | null;
}): Promise<SignatureVerdict> {
  // 1. EOA path first: it needs no network, so an RPC outage cannot affect plain wallets at all.
  try {
    const eoaValid = await verifyMessage({
      address: params.address,
      message: params.message,
      signature: params.signature,
    } as never);
    if (eoaValid) return { kind: 'VALID', signerType: 'EOA' };
  } catch {
    // fall through to the contract path
  }

  if (!params.publicClient) {
    return {
      kind: 'UNKNOWN',
      detail: 'no chain client available to perform an ERC-1271 signature check',
    };
  }

  // 2. Contract-account path. Distinguish "not a contract" (definitively invalid) from
  //    "we could not reach the node" (unknown).
  let bytecode: Hex | undefined;
  try {
    bytecode = await params.publicClient.getCode({ address: params.address });
  } catch (error) {
    return {
      kind: 'UNKNOWN',
      detail: `could not read account code: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!bytecode || bytecode === '0x') {
    // A plain EOA whose offline recovery already failed. This is a real invalid signature.
    return { kind: 'INVALID' };
  }

  try {
    const valid = await params.publicClient.verifyMessage({
      address: params.address,
      message: params.message,
      signature: params.signature,
    });
    return valid ? { kind: 'VALID', signerType: 'ERC1271' } : { kind: 'INVALID' };
  } catch (error) {
    return {
      kind: 'UNKNOWN',
      detail: `ERC-1271 check failed to execute: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
