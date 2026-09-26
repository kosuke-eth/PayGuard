/**
 * Pure ABI round-trip: encode `executePayment` calldata, decode it back, and confirm the decoded
 * invoice/intent equal what was encoded. No RPC needed -- `encodeFunctionData`/`decodeFunctionData`
 * are pure, and this is exactly the check the Stage 5 worker's recovery path relies on before
 * trusting a persisted or recovered raw signed transaction's calldata.
 */
import type { ExceptionApproval, Invoice, PaymentIntent } from '@payguard/domain';
import { describe, expect, it } from 'vitest';
import {
  decodeExecutePaymentInvoiceAndIntent,
  prepareExecutePaymentCalldata,
} from '../src/relayerActions.js';

const VAULT_ADDRESS = '0x1111111111111111111111111111111111111111' as `0x${string}`;
const hexOf = (label: string) => Buffer.from(label, 'utf8').toString('hex');
const HASH = (label: string) => `0x${hexOf(label).padEnd(64, '0').slice(0, 64)}` as `0x${string}`;
const ADDR = (label: string) => `0x${hexOf(label).padEnd(40, '0').slice(0, 40)}` as `0x${string}`;

const invoice: Invoice = {
  invoiceId: HASH('invoiceid'),
  merchantId: HASH('merchantid'),
  recipient: ADDR('recipient'),
  settlementToken: ADDR('settletoken'),
  outputAmount: '1000000',
  category: '7',
  validUntil: '9999999999',
};

const intent: PaymentIntent = {
  policyId: HASH('policyid'),
  invoiceHash: HASH('invoicehash'),
  routeId: HASH('routeid'),
  maxInputAmount: '2000000',
  nonce: '1',
  validUntil: '9999999999',
  subsidyMode: 'BEST_EFFORT',
  maxSubsidyAmount: '500',
};

const approval: ExceptionApproval = {
  intentHash: HASH('approvalintent'),
  nonce: '42',
  validUntil: '9999999999',
};

describe('prepareExecutePaymentCalldata / decodeExecutePaymentInvoiceAndIntent', () => {
  it('round-trips invoice and intent through encode -> decode unchanged', () => {
    const prepared = prepareExecutePaymentCalldata({
      vaultAddress: VAULT_ADDRESS,
      invoice,
      intent,
      signatures: {
        agentSignature: '0xaa',
        merchantSignature: '0xbb',
        approval,
        ownerSignature: '0xcc',
      },
    });

    expect(prepared.to).toBe(VAULT_ADDRESS);
    expect(prepared.data.startsWith('0x')).toBe(true);

    const decoded = decodeExecutePaymentInvoiceAndIntent(prepared.data);
    // viem returns checksummed (mixed-case) addresses on decode; compare case-insensitively.
    expect({
      ...decoded.invoice,
      recipient: decoded.invoice.recipient.toLowerCase(),
      settlementToken: decoded.invoice.settlementToken.toLowerCase(),
    }).toEqual({
      ...invoice,
      recipient: invoice.recipient.toLowerCase(),
      settlementToken: invoice.settlementToken.toLowerCase(),
    });
    expect(decoded.intent).toEqual(intent);
  });

  it('produces a calldataHash that actually matches keccak256 of the returned data', async () => {
    const { keccak256 } = await import('viem');
    const prepared = prepareExecutePaymentCalldata({
      vaultAddress: VAULT_ADDRESS,
      invoice,
      intent,
      signatures: { agentSignature: '0xaa', merchantSignature: '0xbb' },
    });
    expect(prepared.calldataHash).toBe(keccak256(prepared.data));
  });

  it('rejects decoding calldata for a different function', () => {
    expect(() => decodeExecutePaymentInvoiceAndIntent('0x12345678')).toThrow();
  });
});
