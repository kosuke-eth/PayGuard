/**
 * Contract revert decoding against the GENERATED ABI -- never substring matching on English RPC
 * messages (API_CONTRACT.md: "Exact contract errors must be mapped from the generated ABI, not
 * brittle substring matching on RPC messages"; CLAUDE.md: decode the Reason argument of
 * PaymentRejected).
 *
 * The distinction this module exists to preserve: a decoded `PaymentRejected(Reason)` is a real
 * policy answer from the contract, while an RPC transport failure is an *infrastructure unknown*.
 * Collapsing the second into a BLOCK would be a false denial, so `classifyChainFailure` reports
 * them as different kinds and callers map UNKNOWN accordingly.
 */

import { type ReasonWire, reasonFromOnChain } from '@payguard/domain';
import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from 'viem';
import { PAYGUARD_VAULT_ABI } from './generated/abi.js';

export interface DecodedVaultError {
  /** Solidity error name from the generated ABI, e.g. 'PaymentRejected' or 'Unauthorized'. */
  errorName: string;
  /** Present only for PaymentRejected -- the decoded Reason enum member. */
  reason: ReasonWire | null;
  args: readonly unknown[];
}

/**
 * Decodes raw revert data against the compiled vault ABI. Returns null when the data is not a
 * recognized vault error (an unrecognized selector must not be guessed at).
 */
export function decodeVaultRevert(data: Hex): DecodedVaultError | null {
  try {
    const decoded = decodeErrorResult({ abi: PAYGUARD_VAULT_ABI, data });
    const args = (decoded.args ?? []) as readonly unknown[];
    let reason: ReasonWire | null = null;
    if (decoded.errorName === 'PaymentRejected' && args.length > 0) {
      // The ABI types this argument as uint8; viem surfaces it as a number.
      reason = reasonFromOnChain(Number(args[0]));
    }
    return { errorName: decoded.errorName, reason, args };
  } catch {
    return null;
  }
}

export type ChainFailureKind =
  /** The contract executed and deliberately rejected. This IS a policy answer. */
  | 'CONTRACT_REVERT'
  /** The node/provider could not give an answer. This is NOT a policy answer. */
  | 'INFRASTRUCTURE_UNAVAILABLE';

export interface ChainFailure {
  kind: ChainFailureKind;
  decoded: DecodedVaultError | null;
  message: string;
}

/**
 * Classifies a thrown viem error. A revert carrying decodable vault error data is a contract
 * answer; anything else (timeout, connection refused, malformed response) is infrastructure.
 *
 * Callers MUST NOT translate INFRASTRUCTURE_UNAVAILABLE into a BLOCK decision -- API_CONTRACT.md
 * requires UNKNOWN in that case ("A provider failure returns UNKNOWN rather than a false BLOCK").
 */
export function classifyChainFailure(error: unknown): ChainFailure {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const raw = reverted.data?.args !== undefined ? reverted.raw : reverted.raw;
      const decoded = raw !== undefined ? decodeVaultRevert(raw as Hex) : null;
      return {
        kind: 'CONTRACT_REVERT',
        decoded,
        message: reverted.shortMessage,
      };
    }
  }
  return {
    kind: 'INFRASTRUCTURE_UNAVAILABLE',
    decoded: null,
    message: error instanceof Error ? error.message : String(error),
  };
}
