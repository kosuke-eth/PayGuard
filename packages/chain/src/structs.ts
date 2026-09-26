/**
 * Wire (API_CONTRACT.md canonical business models) <-> ABI struct conversion.
 *
 * Every integer crosses this boundary through `parseUIntOfWidth` at its REAL Solidity width, not
 * a blanket uint256 parse: `validAfter`/`validUntil` are uint48 and `category` is uint32
 * (reference/CONTRACT_INTERFACE.sol). A value that is a perfectly valid uint256 decimal string can
 * still be unencodable at uint48, and silently truncating it would produce calldata that means
 * something different from what the caller signed -- so it is rejected here instead.
 *
 * Field ORDER in these objects is irrelevant to viem (it encodes by ABI component name), but the
 * field NAMES and widths must match the ABI exactly; the drift test pins that.
 */
import {
  type Address,
  type ExceptionApproval,
  type Hash32,
  type Invoice,
  type MerchantPermission,
  type PaymentIntent,
  type PolicyConfig,
  parseUIntOfWidth,
  parseUIntString,
  type SubsidyModeWire,
  subsidyModeToOnChain,
} from '@payguard/domain';

const SUBSIDY_MODE_FROM_ONCHAIN: readonly SubsidyModeWire[] = ['NONE', 'REQUIRED', 'BEST_EFFORT'];

export interface AbiInvoice {
  invoiceId: Hash32;
  merchantId: Hash32;
  recipient: Address;
  settlementToken: Address;
  outputAmount: bigint;
  category: number;
  validUntil: number;
}

export interface AbiPaymentIntent {
  policyId: Hash32;
  invoiceHash: Hash32;
  routeId: Hash32;
  maxInputAmount: bigint;
  nonce: bigint;
  validUntil: number;
  subsidyMode: number;
  maxSubsidyAmount: bigint;
}

export interface AbiExceptionApproval {
  intentHash: Hash32;
  nonce: bigint;
  validUntil: number;
}

export interface AbiPolicyConfig {
  agent: Address;
  inputToken: Address;
  settlementToken: Address;
  adapter: Address;
  routeId: Hash32;
  totalOutputBudget: bigint;
  epochOutputBudget: bigint;
  automaticOutputCap: bigint;
  escalationOutputCap: bigint;
  totalInputBudget: bigint;
  maxInputPerPayment: bigint;
  validAfter: number;
  validUntil: number;
  allowedCategoryBitmap: bigint;
  subsidyMode: number;
}

export interface AbiMerchantPermission {
  merchantId: Hash32;
  recipient: Address;
  invoiceSigner: Address;
  category: number;
}

/**
 * uint48/uint32 values are narrow enough that Number is exact (<= 2^48-1 is well under 2^53-1),
 * but the *validation* still happens in bigint via parseUIntOfWidth before this conversion --
 * Number() is only applied to an already-bounds-checked value, never used to do the checking.
 */
function narrow(value: string, bits: 32 | 48): number {
  return Number(parseUIntOfWidth(value, bits));
}

export function toAbiInvoice(invoice: Invoice): AbiInvoice {
  return {
    invoiceId: invoice.invoiceId,
    merchantId: invoice.merchantId,
    recipient: invoice.recipient,
    settlementToken: invoice.settlementToken,
    outputAmount: parseUIntString(invoice.outputAmount),
    category: narrow(invoice.category, 32),
    validUntil: narrow(invoice.validUntil, 48),
  };
}

export function toAbiPaymentIntent(intent: PaymentIntent): AbiPaymentIntent {
  return {
    policyId: intent.policyId,
    invoiceHash: intent.invoiceHash,
    routeId: intent.routeId,
    maxInputAmount: parseUIntString(intent.maxInputAmount),
    nonce: parseUIntString(intent.nonce),
    validUntil: narrow(intent.validUntil, 48),
    subsidyMode: subsidyModeToOnChain(intent.subsidyMode),
    maxSubsidyAmount: parseUIntString(intent.maxSubsidyAmount),
  };
}

export function toAbiApproval(approval: ExceptionApproval): AbiExceptionApproval {
  return {
    intentHash: approval.intentHash,
    nonce: parseUIntString(approval.nonce),
    validUntil: narrow(approval.validUntil, 48),
  };
}

export function toAbiPolicyConfig(config: PolicyConfig): AbiPolicyConfig {
  return {
    agent: config.agent,
    inputToken: config.inputToken,
    settlementToken: config.settlementToken,
    adapter: config.adapter,
    routeId: config.routeId,
    totalOutputBudget: parseUIntString(config.totalOutputBudget),
    epochOutputBudget: parseUIntString(config.epochOutputBudget),
    automaticOutputCap: parseUIntString(config.automaticOutputCap),
    escalationOutputCap: parseUIntString(config.escalationOutputCap),
    totalInputBudget: parseUIntString(config.totalInputBudget),
    maxInputPerPayment: parseUIntString(config.maxInputPerPayment),
    validAfter: narrow(config.validAfter, 48),
    validUntil: narrow(config.validUntil, 48),
    allowedCategoryBitmap: parseUIntString(config.allowedCategoryBitmap),
    subsidyMode: subsidyModeToOnChain(config.subsidyMode),
  };
}

export function toAbiMerchants(merchants: readonly MerchantPermission[]): AbiMerchantPermission[] {
  return merchants.map((merchant) => ({
    merchantId: merchant.merchantId,
    recipient: merchant.recipient,
    invoiceSigner: merchant.invoiceSigner,
    category: narrow(merchant.category, 32),
  }));
}

// --- reverse direction: decoded ABI output -> wire ------------------------------------------

/**
 * Used to build the independently-decoded `review` payload: prepared calldata is decoded BACK
 * through the ABI and rendered as wire values, so the review reflects the actual bytes the wallet
 * will sign rather than the pre-encoding request object (API_CONTRACT.md: the client
 * "independently displays their decoded values before wallet submission").
 */
export function fromAbiPolicyConfig(config: AbiPolicyConfig): PolicyConfig {
  return {
    agent: config.agent,
    inputToken: config.inputToken,
    settlementToken: config.settlementToken,
    adapter: config.adapter,
    routeId: config.routeId,
    totalOutputBudget: config.totalOutputBudget.toString(10),
    epochOutputBudget: config.epochOutputBudget.toString(10),
    automaticOutputCap: config.automaticOutputCap.toString(10),
    escalationOutputCap: config.escalationOutputCap.toString(10),
    totalInputBudget: config.totalInputBudget.toString(10),
    maxInputPerPayment: config.maxInputPerPayment.toString(10),
    validAfter: config.validAfter.toString(10),
    validUntil: config.validUntil.toString(10),
    allowedCategoryBitmap: config.allowedCategoryBitmap.toString(10),
    subsidyMode: SUBSIDY_MODE_FROM_ONCHAIN[config.subsidyMode] ?? 'NONE',
  };
}

/**
 * Reverse of `toAbiInvoice`/`toAbiPaymentIntent` -- used by the Stage 5 worker to decode a raw
 * signed `executePayment` transaction's calldata back into the wire objects it claims to encode,
 * so recovered/persisted bytes can be verified against the DB's own stored invoice/intent rather
 * than trusted on a bare selector match.
 */
export function fromAbiInvoice(invoice: AbiInvoice): Invoice {
  return {
    invoiceId: invoice.invoiceId,
    merchantId: invoice.merchantId,
    recipient: invoice.recipient,
    settlementToken: invoice.settlementToken,
    outputAmount: invoice.outputAmount.toString(10),
    category: invoice.category.toString(10),
    validUntil: invoice.validUntil.toString(10),
  };
}

export function fromAbiPaymentIntent(intent: AbiPaymentIntent): PaymentIntent {
  return {
    policyId: intent.policyId,
    invoiceHash: intent.invoiceHash,
    routeId: intent.routeId,
    maxInputAmount: intent.maxInputAmount.toString(10),
    nonce: intent.nonce.toString(10),
    validUntil: intent.validUntil.toString(10),
    subsidyMode: SUBSIDY_MODE_FROM_ONCHAIN[intent.subsidyMode] ?? 'NONE',
    maxSubsidyAmount: intent.maxSubsidyAmount.toString(10),
  };
}

export function fromAbiMerchants(
  merchants: readonly AbiMerchantPermission[],
): MerchantPermission[] {
  return merchants.map((merchant) => ({
    merchantId: merchant.merchantId,
    recipient: merchant.recipient,
    invoiceSigner: merchant.invoiceSigner,
    category: merchant.category.toString(10),
  }));
}
