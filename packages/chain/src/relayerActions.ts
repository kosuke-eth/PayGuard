/**
 * Relayer-side `executePayment` calldata: encoding and decode-back verification, mirroring
 * `ownerActions.ts`'s pattern (encode, then decode the SAME bytes back through the ABI so a
 * caller never trusts its own request object as evidence of what will actually be signed/sent).
 *
 * Used by the Stage 5 worker only. Nothing here signs or sends -- CLAUDE.md's "no arbitrary
 * transaction endpoint" rule applies just as much to the relayer as the owner: this module emits
 * exactly one encoding (the full six-argument `executePayment` call) and nothing else.
 */
import {
  type Address,
  type ExceptionApproval,
  type Hash32,
  type HexBytes,
  type Invoice,
  type PaymentIntent,
  ZERO_APPROVAL,
  ZERO_APPROVAL_SIGNATURE,
} from '@payguard/domain';
import { decodeFunctionData, encodeFunctionData, keccak256 } from 'viem';
import { PAYGUARD_VAULT_ABI } from './generated/abi.js';
import {
  type AbiInvoice,
  type AbiPaymentIntent,
  fromAbiInvoice,
  fromAbiPaymentIntent,
  toAbiApproval,
  toAbiInvoice,
  toAbiPaymentIntent,
} from './structs.js';
import type { SignatureSet } from './vault.js';

export interface PreparedExecutePaymentCall {
  to: Address;
  data: HexBytes;
  calldataHash: Hash32;
}

/** Encodes the real `executePayment(invoice, intent, agentSig, merchantSig, approval, ownerSig)` call. */
export function prepareExecutePaymentCalldata(params: {
  vaultAddress: Address;
  invoice: Invoice;
  intent: PaymentIntent;
  signatures: SignatureSet;
}): PreparedExecutePaymentCall {
  const data = encodeFunctionData({
    abi: PAYGUARD_VAULT_ABI,
    functionName: 'executePayment',
    args: [
      toAbiInvoice(params.invoice),
      toAbiPaymentIntent(params.intent),
      params.signatures.agentSignature,
      params.signatures.merchantSignature,
      toAbiApproval(params.signatures.approval ?? ZERO_APPROVAL),
      params.signatures.ownerSignature ?? ZERO_APPROVAL_SIGNATURE,
    ] as never,
  }) as HexBytes;
  return {
    to: params.vaultAddress,
    data,
    calldataHash: keccak256(data) as Hash32,
  };
}

/**
 * Decodes `executePayment` calldata back to its `invoice`/`intent` arguments, so recovery can
 * confirm stored/recovered raw bytes really encode the payment they claim to (never trusted from
 * a bare selector match).
 */
export function decodeExecutePaymentInvoiceAndIntent(data: HexBytes): {
  invoice: Invoice;
  intent: PaymentIntent;
} {
  const decoded = decodeFunctionData({ abi: PAYGUARD_VAULT_ABI, data });
  if (decoded.functionName !== 'executePayment') {
    throw new Error(
      `decodeExecutePaymentInvoiceAndIntent: expected executePayment, got ${decoded.functionName}`,
    );
  }
  const args = decoded.args as readonly [AbiInvoice, AbiPaymentIntent, ...unknown[]];
  return {
    invoice: fromAbiInvoice(args[0]),
    intent: fromAbiPaymentIntent(args[1]),
  };
}

export type { ExceptionApproval };
