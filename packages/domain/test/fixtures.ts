import type { PayGuardDomain } from '../src/eip712.js';
import type { Address, Hash32 } from '../src/primitives.js';
import type { ExceptionApproval, Invoice, PaymentIntent } from '../src/types.js';

/**
 * Fixed Stage 1 cross-language vector inputs. These exact literal values are duplicated
 * verbatim (not derived/imported) in contracts/core-v4/test/Eip712Vectors.t.sol so the two
 * implementations are genuinely independent. Do not change one without changing the other and
 * regenerating docs/implementation/evidence/eip712-vectors.json.
 */

function hash32Of(byte: string): Hash32 {
  return `0x${byte.repeat(32)}` as Hash32;
}
function addressOf(byte: string): Address {
  return `0x${byte.repeat(20)}` as Address;
}

export const TEST_DOMAIN: PayGuardDomain = {
  chainId: 31337,
  verifyingContract: addressOf('f1'),
};

export const WRONG_DOMAIN_CHAIN: PayGuardDomain = {
  chainId: 1,
  verifyingContract: TEST_DOMAIN.verifyingContract,
};

export const WRONG_DOMAIN_CONTRACT: PayGuardDomain = {
  chainId: TEST_DOMAIN.chainId,
  verifyingContract: addressOf('f2'),
};

export const FIXTURE_INVOICE: Invoice = {
  invoiceId: hash32Of('11'),
  merchantId: hash32Of('22'),
  recipient: addressOf('a1'),
  settlementToken: addressOf('b1'),
  outputAmount: '500000',
  category: '3',
  validUntil: '2000000000',
};

export const FIXTURE_INVOICE_CHANGED_AMOUNT: Invoice = {
  ...FIXTURE_INVOICE,
  outputAmount: '500001',
};

export const FIXTURE_INTENT: PaymentIntent = {
  policyId: hash32Of('33'),
  invoiceHash: hash32Of('44'),
  routeId: hash32Of('55'),
  maxInputAmount: '2600000000000000',
  nonce: '1',
  validUntil: '2000000000',
  subsidyMode: 'NONE',
  maxSubsidyAmount: '0',
};

export const FIXTURE_APPROVAL: ExceptionApproval = {
  intentHash: hash32Of('66'),
  nonce: '12345',
  validUntil: '2000000000',
};

export const FIXTURE_APPROVAL_CHANGED_NONCE: ExceptionApproval = {
  ...FIXTURE_APPROVAL,
  nonce: '12346',
};
